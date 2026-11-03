import { serve } from '@hono/node-server'
import { DEFAULT_ADAPTERS } from '@blueyvatar/core'
import { createApp } from './app.js'
import { MemoryLicenseStore, MemoryRateLimiter, type LicenseStore, type RateLimiter } from './licenses.js'
import { createPool, PgIndexStore, PgLicenseStore, PgRateLimiter, PgUsageMeter } from './pg-store.js'
import { sandboxedResizer } from './resize.js'
import { AtprotoResolver } from './resolver.js'
import { MemoryIndexStore, type IndexStore } from './store.js'
import { MemoryUsageMeter, type UsageMeter } from './usage.js'

interface Stores { index: IndexStore; licenses: LicenseStore; limiter: RateLimiter; usage: UsageMeter }

// Postgres when DATABASE_URL is set (schema in db/migrations); memory stores for local dev.
function stores(): Stores {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.warn('DATABASE_URL is not set; using in-memory stores')
    return { index: new MemoryIndexStore(), licenses: new MemoryLicenseStore(), limiter: new MemoryRateLimiter(), usage: new MemoryUsageMeter() }
  }
  const pool = createPool(url)
  pool.on('error', (err) => console.error('postgres pool error', err))
  return { index: new PgIndexStore(pool), licenses: new PgLicenseStore(pool), limiter: new PgRateLimiter(pool), usage: new PgUsageMeter(pool) }
}

const { index, licenses, limiter, usage } = stores()
const app = createApp({
  index,
  resolver: new AtprotoResolver({ index, adapters: DEFAULT_ADAPTERS, log: (m, meta) => console.warn(m, meta) }),
  licenses,
  limiter,
  usage,
  resize: sandboxedResizer(),
  defaultUrlAllowlist: (process.env.DEFAULT_URL_ALLOWLIST ?? '').split(',').filter(Boolean),
  trustCloudflare: process.env.TRUST_CLOUDFLARE === 'true',
  remoteAddress: (c) => (c.env as { incoming?: { socket?: { remoteAddress?: string } } })?.incoming?.socket?.remoteAddress,
})

const port = Number(process.env.PORT ?? 3001)
serve({ fetch: app.fetch, port }, () => console.log(`delivery listening on ${port}`))
