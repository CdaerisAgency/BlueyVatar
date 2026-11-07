import { randomBytes } from 'node:crypto'
import { serve } from '@hono/node-server'
import type pg from 'pg'
import { DEFAULT_ADAPTERS } from '@blueyvatar/core'
import { emailSender, Notifier, pgNoticeDirectory } from '@blueyvatar/core/verification'
import { ConsoleAlertSink, EmailAlertSink, MemoryAlertLedger, UsageAlerts, type AlertLedger } from './alerts.js'
import { createApp } from './app.js'
import { errors, log, metrics, resolverLog } from './obs.js'
import { originLockWarning } from './origin.js'
import { MemoryLicenseStore, MemoryRateLimiter, type LicenseStore, type RateLimiter } from './licenses.js'
import { scheduleLogRetention } from './log-retention.js'
import { scheduleRateWindowCleanup } from './rate-cleanup.js'
import { createPool, PgAlertLedger, pgLicenseOwner, PgIndexStore, PgLicenseStore, PgRateLimiter, PgUsageMeter } from './pg-store.js'
import { BatchedRateLimiter, BatchedUsageMeter } from './batch.js'
import { limitedResizer, resizeLimitsFromEnv, sandboxedResizer } from './resize.js'
import { AtprotoResolver } from './resolver.js'
import { MemoryIndexStore, type IndexStore } from './store.js'
import { MemoryUsageMeter, type UsageMeter } from './usage.js'

interface Stores { pool?: pg.Pool; index: IndexStore; licenses: LicenseStore; limiter: RateLimiter; usage: UsageMeter; ledger: AlertLedger }

// Postgres when DATABASE_URL is set (schema in db/migrations); memory stores for local dev.
function stores(): Stores {
  const url = process.env.DATABASE_URL
  if (!url) {
    log.warn('DATABASE_URL is not set; using in-memory stores')
    return { index: new MemoryIndexStore(), licenses: new MemoryLicenseStore(), limiter: new MemoryRateLimiter(), usage: new MemoryUsageMeter(), ledger: new MemoryAlertLedger() }
  }
  const pool = createPool(url)
  pool.on('error', (err) => {
    metrics.inc('delivery_postgres_errors_total', { source: 'pool' })
    log.error('postgres pool error', { err })
    errors.captureException(err, { tags: { task: 'postgres_pool' } })
  })
  // RATE_BATCH_MS is the flush period of the in-memory first tier for rate windows and usage counters (default 1000; 0 writes through on every request).
  const flushMs = process.env.RATE_BATCH_MS === undefined || process.env.RATE_BATCH_MS === '' ? 1000 : Number(process.env.RATE_BATCH_MS)
  const onError = (err: unknown) => { metrics.inc('delivery_postgres_errors_total', { source: 'batch_flush' }); log.error('batched counter flush failed', { err }) }
  const pgLimiter = new PgRateLimiter(pool)
  const pgUsage = new PgUsageMeter(pool)
  if (!(flushMs > 0)) return { pool, index: new PgIndexStore(pool), licenses: new PgLicenseStore(pool), limiter: pgLimiter, usage: pgUsage, ledger: new PgAlertLedger(pool) }
  const limiter = new BatchedRateLimiter(pgLimiter, { flushMs, onError })
  const usage = new BatchedUsageMeter(pgUsage, { flushMs, onError })
  const shutdown = () => { void Promise.all([limiter.close(), usage.close()]).finally(() => process.exit(0)) }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
  return { pool, index: new PgIndexStore(pool), licenses: new PgLicenseStore(pool), limiter, usage, ledger: new PgAlertLedger(pool) }
}

const { pool, index, licenses, limiter, usage, ledger } = stores()
if (pool) { scheduleRateWindowCleanup(pool); scheduleLogRetention(pool) }
// Usage alerts go to the owner's primary email when a database is configured; otherwise they are logged.
const alertSink = pool
  ? new EmailAlertSink(new Notifier(emailSender(), pgNoticeDirectory(pool)), pgLicenseOwner(pool), process.env.PUBLIC_URL ?? 'https://blueyvatar.com')
  : new ConsoleAlertSink()
const originWarning = originLockWarning(process.env)
if (originWarning) log.warn(originWarning)
// Without a configured secret, /img URLs only work for this process's lifetime (local dev).
let imgSigningSecret = process.env.IMG_SIGNING_SECRET
if (!imgSigningSecret) {
  log.warn('IMG_SIGNING_SECRET is not set; using a random per-process secret, so /img URLs break on restart')
  imgSigningSecret = randomBytes(32).toString('hex')
}
const app = createApp({
  index,
  resolver: new AtprotoResolver({ index, adapters: DEFAULT_ADAPTERS, log: (m, meta) => resolverLog(m, meta) }),
  licenses,
  limiter,
  usage,
  alerts: new UsageAlerts(alertSink, ledger),
  // Caps concurrent resize workers (IMG_MAX_CONCURRENT, default 2 for the 512 MB VM) and queues briefly; overflow is a 503 with Retry-After.
  resize: limitedResizer(sandboxedResizer(), {
    ...resizeLimitsFromEnv(),
    onChange: ({ inFlight, queued, shed }) => {
      metrics.set('delivery_transforms_in_flight', inFlight)
      metrics.set('delivery_transforms_queued', queued)
      if (shed) metrics.inc('delivery_transforms_shed_total')
    },
  }),
  defaultUrlAllowlist: (process.env.DEFAULT_URL_ALLOWLIST ?? '').split(',').filter(Boolean),
  profileBaseUrl: process.env.PROFILE_BASE_URL || undefined,
  originSecret: process.env.ORIGIN_SECRET || undefined,
  warmSecret: process.env.WARM_SECRET || undefined,
  imgSigningSecret,
  logger: log,
  metrics,
  errors,
  ready: pool ? async () => { await pool.query('SELECT 1') } : undefined,
  readyTimeoutMs: Number(process.env.READY_TIMEOUT_MS ?? 3000) || 3000,
  metricsToken: process.env.METRICS_TOKEN || undefined,
  plusDids: process.env.PLUS_DIDS,
  trustCloudflare: process.env.TRUST_CLOUDFLARE === 'true',
  remoteAddress: (c) => (c.env as { incoming?: { socket?: { remoteAddress?: string } } })?.incoming?.socket?.remoteAddress,
})

const port = Number(process.env.PORT ?? 3001)
serve({ fetch: app.fetch, port }, () => log.info('delivery listening', { port }))

process.on('unhandledRejection', (err) => {
  log.error('unhandled rejection', { err })
  errors.captureException(err, { tags: { task: 'unhandled_rejection' } })
})
