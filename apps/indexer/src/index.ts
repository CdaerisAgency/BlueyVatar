import { SimpleIndexer, Tap } from '@atproto/tap'
import pg from 'pg'
import { purgerFromEnv } from './cloudflare.js'
import { warmerFromEnv } from './warm.js'
import { handleRecord, type IndexWrites } from './handlers.js'
import { PgIndexWrites } from './pg-writes.js'
import { pgReverifyStore, reverifyDue, scheduleReverify } from './reverify.js'
import { reverifyFromEnv } from './reverify-wiring.js'

/**
 * Tap runs as its own Fly app, configured with the service profile
 * record as its signal collection and the four collections in handlers.ts as
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
    pool.on('error', (err) => console.error('postgres pool error', err))
    // Re-check attested claims older than REVERIFY_AFTER_DAYS every REVERIFY_INTERVAL_HOURS.
    const rv = reverifyFromEnv()
    const store = pgReverifyStore(pool)
    scheduleReverify(() => reverifyDue({ store, verify: rv.verify, remove: rv.remove, onRevoked: rv.onRevoked }, { afterMs: rv.afterMs, minGapMs: rv.everyMs * 0.8 }), rv.everyMs)
    return new PgIndexWrites(pool, { onPurge: purgerFromEnv(), onImageUpserted: warmerFromEnv() })
  }
  console.warn('DATABASE_URL is not set; logging index writes to the console')
  return {
    upsertImage: async (r) => console.log('upsertImage', r),
    deleteImage: async (did, rkey) => console.log('deleteImage', did, rkey),
    upsertProfile: async (did) => console.log('upsertProfile', did),
    deleteProfile: async (did) => console.log('deleteProfile', did),
    upsertClaim: async (did, rkey) => console.log('upsertClaim', did, rkey),
    deleteClaim: async (did, rkey) => console.log('deleteClaim', did, rkey),
    upsertProfileLink: async (r) => console.log('upsertProfileLink', r),
    deleteProfileLink: async (did, rkey) => console.log('deleteProfileLink', did, rkey),
    setRepoStatus: async (did, handle, active, status) => console.log('setRepoStatus', did, handle, active, status),
    purgeImages: async (did, cids) => console.log('purgeImages', did, cids),
  }
}
const db = writes()

const indexer = new SimpleIndexer()
indexer.identity(async (evt) => {
  await db.setRepoStatus(evt.did, evt.handle, evt.isActive, evt.status)
})
indexer.record(async (evt) => {
  await handleRecord(
    { did: evt.did, collection: evt.collection, rkey: evt.rkey, cid: evt.cid, action: evt.action, record: evt.record as Record<string, unknown> | undefined },
    db,
  )
})
indexer.error((err) => console.error('tap error', err))

const channel = tap.channel(indexer)
process.on('SIGTERM', () => void channel.destroy())
await channel.start()
