import { Tap } from '@atproto/tap'
import pg from 'pg'
import { scheduleBillingPurge } from './billing-retention.js'
import { scheduleModerationDigest } from './moderation-digest.js'
import { purgerFromEnv } from './cloudflare.js'
import { warmerFromEnv } from './warm.js'
import type { IndexWrites } from './handlers.js'
import { PgIndexWrites } from './pg-writes.js'
import { pgReverifyStore, reverifyDue, scheduleReverify } from './reverify.js'
import { reverifyFromEnv } from './reverify-wiring.js'
import { IndexerHealth, probeTap, startHealthServer } from './health.js'
import { errors, log, metrics } from './obs.js'
import { createIndexer } from './wiring.js'
import { PgLabelStore, labelerDidsFromEnv, runLabeler } from './labels.js'
import { wsLabelSource } from './label-stream.js'

/**
 * Tap runs as its own Fly app, configured with the service profile
 * record as its signal collection and the collections in handlers.ts as
 * its collection filters (spec section 4). Tap is in beta; Jetstream is the
 * documented fallback.
 */
const tapUrl = process.env.TAP_URL ?? 'http://localhost:2480'
const tap = new Tap(tapUrl, { adminPassword: process.env.TAP_ADMIN_PASSWORD })

// Postgres when DATABASE_URL is set (schema in db/migrations); console logging for local dev.
function writes(): IndexWrites {
  const url = process.env.DATABASE_URL
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 5) })
    pool.on('error', (err) => {
      metrics.inc('indexer_postgres_errors_total')
      log.error('postgres pool error', { err })
      errors.captureException(err, { tags: { task: 'postgres_pool' } })
    })
    // Re-check attested claims older than REVERIFY_AFTER_DAYS every REVERIFY_INTERVAL_HOURS.
    const rv = reverifyFromEnv(pool)
    const store = pgReverifyStore(pool)
    scheduleReverify(() => reverifyDue({ store, verify: rv.verify, remove: rv.remove, onRevoked: rv.onRevoked }, { afterMs: rv.afterMs, minGapMs: rv.everyMs * 0.8 }), rv.everyMs)
    // Deletes Stripe billing rows 7 years after their owner deleted their data.
    scheduleBillingPurge(pool)
    // Daily moderation digest email to the admin address (counts only). Off until an address or ADMIN_DIDS exists.
    scheduleModerationDigest(pool)
    const warm = warmerFromEnv()
    const purge = purgerFromEnv()
    // Moderation labels (issue #207): one subscription per DID in LABELER_DIDS. Off when the list is empty.
    const labelers = labelerDidsFromEnv()
    if (labelers.length === 0) log.info('LABELER_DIDS is not set; label enforcement is off')
    const labelStore = new PgLabelStore(pool, { onRemoved: purge })
    for (const did of labelers) void runLabeler(did, wsLabelSource(did), labelStore)
    return new PgIndexWrites(pool, { onPurge: purge, onImageUpserted: warm, onWarm: warm })
  }
  log.warn('DATABASE_URL is not set; logging index writes only')
  const dev = (op: string) => async (...args: unknown[]) => log.info('index write (dev, not stored)', { op, args })
  return {
    upsertImage: dev('upsertImage'), deleteImage: dev('deleteImage'),
    upsertProfile: dev('upsertProfile'), deleteProfile: dev('deleteProfile'),
    upsertClaim: dev('upsertClaim'), deleteClaim: dev('deleteClaim'),
    upsertProfileLink: dev('upsertProfileLink'), deleteProfileLink: dev('deleteProfileLink'),
    setRepoStatus: dev('setRepoStatus'), purgeImages: dev('purgeImages'),
  }
}
const db = writes()

// Readiness: Tap events or Tap health answers must keep arriving (INDEXER_STALL_SECONDS, default 300).
const stallSeconds = Number(process.env.INDEXER_STALL_SECONDS ?? 300) || 300
const health = new IndexerHealth({ windowMs: stallSeconds * 1000 })
const probeEvery = Number(process.env.TAP_PROBE_INTERVAL_SECONDS ?? 15) || 15
const probe = () => probeTap({ tapUrl, adminPassword: process.env.TAP_ADMIN_PASSWORD }, health)
  .then((ok) => { if (!ok) log.warn('tap health probe failed') })
void probe()
setInterval(() => void probe(), probeEvery * 1000).unref()
startHealthServer({ health, metrics, port: Number(process.env.HEALTH_PORT ?? 8080) })

/** Runs one Tap event handler with readiness bookkeeping, metrics, and error reporting. */
async function tracked(type: 'identity' | 'record', id: number, run: () => Promise<void>): Promise<void> {
  try {
    await run()
    health.markEvent(id)
    metrics.inc('indexer_events_total', { type, result: 'ok' })
  } catch (err) {
    health.markFailure()
    metrics.inc('indexer_events_total', { type, result: 'error' })
    log.error('event handling failed', { type, eventId: id, err })
    errors.captureException(err, { tags: { task: 'tap_event', event_type: type } })
    throw err
  }
}

const indexer = createIndexer(db, (err) => {
  log.error('tap error', { err })
  errors.captureException(err, { tags: { task: 'tap_channel' } })
}, tracked)

const channel = tap.channel(indexer)
process.on('SIGTERM', () => void channel.destroy())
process.on('unhandledRejection', (err) => {
  log.error('unhandled rejection', { err })
  errors.captureException(err, { tags: { task: 'unhandled_rejection' } })
})
log.info('indexer starting', { tapUrl, stallSeconds })
await channel.start()
