// Direct cost of the rate-window upsert and the usage-counter upsert (issue #149), measured
// with the production PgRateLimiter and PgUsageMeter against a database, no HTTP in the way.
// Compares writes spread over many buckets with writes on a single hot bucket.
//
// Needs the seeded license lt-license-0 (usage_counters has a foreign key to licenses); run seed.mjs first.
//   DATABASE_URL=postgres://postgres@localhost/bv_loadtest node src/bench-rate.mjs --concurrency 1,10,50 --ops 20000
import { parseArgs } from 'node:util'
import { randomInt } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { writeFileSync } from 'node:fs'
import { createPool, PgRateLimiter, PgUsageMeter } from '../../../apps/delivery/dist/pg-store.js'
import { assertDatabaseAllowed } from './guard.mjs'
import { summarize } from './stats.mjs'

const { values: a } = parseArgs({
  options: { concurrency: { type: 'string', default: '1,10,50' }, ops: { type: 'string', default: '20000' }, out: { type: 'string', default: 'bench-rate.json' }, 'i-know': { type: 'boolean', default: false } },
})
const url = process.env.DATABASE_URL
if (!url) { console.error('Set DATABASE_URL'); process.exit(1) }
assertDatabaseAllowed(url, a['i-know'])
const pool = createPool(url)
// The pool caps concurrent statements, as in production (PG_POOL_MAX, default 10).
const limiter = new PgRateLimiter(pool)
const meter = new PgUsageMeter(pool)
const ops = Number(a.ops)
const r1 = (x) => Math.round(x * 100) / 100

const cases = {
  'rate upsert, distinct bucket per call': (i) => limiter.hit(`lt-bench:ip:${randomInt(2 ** 31)}-${i}`, 100, 86400),
  'rate upsert, one hot bucket': () => limiter.hit('lt-bench:hot', 1_000_000_000, 86400),
  'usage upsert, one hot license': () => meter.add('lt-license-0', 'origin_resolution'),
  'rate + usage on one hot license (keyed request)': async () => { await limiter.hit('lt-bench:lic:d', 1_000_000_000, 86400); await meter.add('lt-license-0', 'origin_resolution') },
}

const out = []
try {
  for (const [name, fn] of Object.entries(cases)) {
    for (const c of a.concurrency.split(',').map(Number)) {
      const lat = []
      let next = 0
      const t0 = performance.now()
      await Promise.all(Array.from({ length: c }, async () => {
        while (next < ops) {
          const i = next++
          const s = performance.now()
          await fn(i)
          lat.push(performance.now() - s)
        }
      }))
      const secs = (performance.now() - t0) / 1000
      const l = summarize(lat)
      const row = { case: name, concurrency: c, ops, opsPerSec: Math.round(ops / secs), p50Ms: r1(l.p50), p95Ms: r1(l.p95), p99Ms: r1(l.p99) }
      out.push(row)
      console.log(JSON.stringify(row))
    }
  }
} finally {
  await pool.query(`DELETE FROM rate_windows WHERE bucket LIKE 'lt-bench:%'`)
  await pool.query(`DELETE FROM usage_counters WHERE license_id = 'lt-license-0'`)
  await pool.end()
}
writeFileSync(a.out, JSON.stringify(out, null, 2))
