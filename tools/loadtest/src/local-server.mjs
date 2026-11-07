// Local delivery server for load testing against local Postgres (issue #149).
// It is the real delivery app (apps/delivery/dist) with the real Postgres stores, the real
// rate limiter, and the real sandboxed sharp resizer. Only the atproto network is replaced:
// identity resolution and PDS blob fetches are served from the synthetic seed rows with a
// configurable delay, because a local run must not reach plc.directory or any PDS.
//
// Build delivery first (pnpm --filter @blueyvatar/delivery build). Then:
//   DATABASE_URL=postgres://postgres@localhost:5432/bv_loadtest node src/local-server.mjs
//
// Env: PORT (3101), IMG_SIGNING_SECRET, LT_COLD_MS (25, simulated PLC + PDS describe on a cache
// miss), LT_BLOB_MS (40, simulated PDS getBlob), PG_POOL_MAX (10, same default as production).
import { serve } from '@hono/node-server'
import sharp from 'sharp'
import { createApp } from '../../../apps/delivery/dist/app.js'
import { createPool, PgIndexStore, PgLicenseStore, PgRateLimiter, PgUsageMeter } from '../../../apps/delivery/dist/pg-store.js'
import { sandboxedResizer } from '../../../apps/delivery/dist/resize.js'
import { Metrics } from '@blueyvatar/core'

const url = process.env.DATABASE_URL
if (!url) { console.error('Set DATABASE_URL'); process.exit(1) }
const host = new URL(url).hostname
if (!['localhost', '127.0.0.1', '::1', ''].includes(host)) { console.error('local-server only runs against a local database'); process.exit(1) }

const COLD_MS = Number(process.env.LT_COLD_MS ?? 25)
const BLOB_MS = Number(process.env.LT_BLOB_MS ?? 40)
const secret = process.env.IMG_SIGNING_SECRET ?? 'loadtest-local-secret'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pool = createPool(url)
const index = new PgIndexStore(pool)

// 1024x1024 noise JPEG, about the size of a typical uploaded avatar original.
const original = new Uint8Array(await sharp({ create: { width: 1024, height: 1024, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 50 } } }).jpeg({ quality: 90 }).toBuffer())

/** Resolver backed by the repos table, with an in-memory identity cache like AtprotoResolver. */
const cache = new Map()
const resolver = {
  async resolveIdentity({ kind, value }) {
    const key = `${kind}:${value.toLowerCase()}`
    const hit = cache.get(key)
    if (hit) return hit
    await sleep(COLD_MS)
    const col = kind === 'did' ? 'did' : 'lower(handle)'
    const { rows } = await pool.query(`SELECT did, handle FROM repos WHERE ${col} = $1`, [kind === 'did' ? value : value.toLowerCase()])
    if (!rows[0]) return null
    const id = { did: rows[0].did, handle: rows[0].handle, pds: 'https://pds.loadtest.invalid' }
    cache.set(key, id)
    if (cache.size > 200_000) cache.delete(cache.keys().next().value)
    return id
  },
  async candidates(identity) {
    const imgs = await index.serviceImages(identity.did)
    return imgs.map((i) => ({ source: i.isDefault ? 'blueyvatar-default' : 'blueyvatar', did: identity.did, blob: { cid: i.cid, mimeType: i.mimeType }, rating: i.rating, updatedAt: i.createdAt }))
  },
  async galleryItems() { return [] },
  async getRecord() { return null },
  async getBlob() { await sleep(BLOB_MS); return original },
}

const app = createApp({
  index,
  resolver,
  licenses: new PgLicenseStore(pool),
  limiter: new PgRateLimiter(pool),
  usage: new PgUsageMeter(pool),
  resize: sandboxedResizer(),
  defaultUrlAllowlist: [],
  imgSigningSecret: secret,
  metrics: new Metrics(),
  // Per-request client IPs come from cf-connecting-ip, as they do behind Cloudflare.
  trustCloudflare: true,
})

const port = Number(process.env.PORT ?? 3101)
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => console.log(`loadtest delivery listening on 127.0.0.1:${port} pid=${process.pid} cold=${COLD_MS}ms blob=${BLOB_MS}ms pool=${pool.options.max}`))
