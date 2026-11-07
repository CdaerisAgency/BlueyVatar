// Seeds synthetic linked hashes, images, and API keys for the load test (issue #149).
// Everything is synthetic: DIDs start with did:plc:zzlt, emails end in @loadtest.invalid,
// handles end in .loadtest.invalid. No real account is touched. Never point this at production.
//
//   DATABASE_URL=postgres://... node src/seed.mjs --count 20000 --keys 200 --out targets.json
//   DATABASE_URL=postgres://... node src/seed.mjs --clean
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import pg from 'pg'
import { assertDatabaseAllowed } from './guard.mjs'

const { values: a } = parseArgs({
  options: {
    count: { type: 'string', default: '20000' },
    keys: { type: 'string', default: '200' },
    out: { type: 'string', default: 'targets.json' },
    clean: { type: 'boolean', default: false },
    'i-know': { type: 'boolean', default: false },
  },
})
const url = process.env.DATABASE_URL
if (!url) { console.error('Set DATABASE_URL to a local or staging database'); process.exit(1) }
assertDatabaseAllowed(url, a['i-know'])

const sha = (s) => createHash('sha256').update(s).digest()
const hex = (s) => sha(s).toString('hex')
const md5 = (s) => createHash('md5').update(s).digest('hex')
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
function b32(buf, n) {
  let bits = 0, acc = 0, out = ''
  for (const byte of buf) { acc = (acc << 8) | byte; bits += 8; while (bits >= 5 && out.length < n) { out += B32[(acc >>> (bits - 5)) & 31]; bits -= 5 } }
  return out
}
const did = (i) => `did:plc:zzlt${b32(sha(`did-${i}`), 20)}`
const cid = (i) => `bafkreizzlt${b32(sha(`cid-${i}`), 44)}`
const handle = (i) => `lt${i}.loadtest.invalid`
const email = (i) => `lt-${i}@loadtest.invalid`

const pool = new pg.Pool({ connectionString: url, max: 2 })
try {
  if (a.clean) {
    await pool.query(`DELETE FROM api_keys WHERE license_id LIKE 'lt-license-%'`)
    await pool.query(`DELETE FROM licenses WHERE license_id LIKE 'lt-license-%'`)
    await pool.query(`DELETE FROM images WHERE did LIKE 'did:plc:zzlt%'`)
    await pool.query(`DELETE FROM email_links WHERE did LIKE 'did:plc:zzlt%'`)
    await pool.query(`DELETE FROM repos WHERE did LIKE 'did:plc:zzlt%'`)
    await pool.query(`DELETE FROM usage_counters WHERE license_id LIKE 'lt-license-%'`)
    await pool.query(`DELETE FROM service_usage_counters WHERE did LIKE 'did:plc:zzlt%'`)
    console.log('removed synthetic rows')
  } else {
    const n = Number(a.count)
    const k = Number(a.keys)
    const idx = Array.from({ length: n }, (_, i) => i)
    const chunk = 5000
    for (let s = 0; s < n; s += chunk) {
      const part = idx.slice(s, s + chunk)
      await pool.query(
        `INSERT INTO repos (did, handle) SELECT * FROM unnest($1::text[], $2::text[]) ON CONFLICT (did) DO NOTHING`,
        [part.map(did), part.map(handle)],
      )
      await pool.query(
        `INSERT INTO email_links (email_hash, email_md5, did, method)
           SELECT h, m, d, 'code' FROM unnest($1::text[], $2::text[], $3::text[]) AS t(h, m, d) ON CONFLICT DO NOTHING`,
        [part.map((i) => hex(email(i))), part.map((i) => md5(email(i))), part.map(did)],
      )
      await pool.query(
        `INSERT INTO images (did, rkey, cid, mime_type, rating, is_default, created_at, purpose)
           SELECT d, 'lt1', c, 'image/jpeg', 'g', true, now(), 'avatar' FROM unnest($1::text[], $2::text[]) AS t(d, c) ON CONFLICT DO NOTHING`,
        [part.map(did), part.map(cid)],
      )
    }
    const keys = []
    for (let i = 0; i < k; i++) {
      const key = `bvk_lt_${b32(sha(`key-${i}`), 32)}`
      const licenseId = `lt-license-${i}`
      await pool.query(
        `INSERT INTO licenses (license_id, owner, tier, status) VALUES ($1, $2, 'business', 'active') ON CONFLICT DO NOTHING`,
        [licenseId, did(i)],
      )
      await pool.query(
        `INSERT INTO api_keys (key_hash, prefix, license_id, kind, label) VALUES ($1, $2, $3, 'secret', 'loadtest') ON CONFLICT DO NOTHING`,
        [hex(key), key.slice(0, 10), licenseId],
      )
      keys.push(key)
    }
    const targets = {
      generatedBy: 'tools/loadtest/src/seed.mjs',
      count: n,
      hashes: idx.map((i) => hex(email(i))),
      handles: idx.map(handle),
      images: idx.map((i) => ({ did: did(i), cid: cid(i) })),
      keys,
    }
    writeFileSync(a.out, JSON.stringify(targets))
    console.log(`seeded ${n} identities and ${k} keys; wrote ${a.out}`)
  }
} finally {
  await pool.end()
}
