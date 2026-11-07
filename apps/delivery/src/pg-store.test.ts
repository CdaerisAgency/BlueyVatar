import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashApiKey, PgAlertLedger, PgIndexStore, PgLicenseStore, PgRateLimiter, PgUsageMeter } from './pg-store.js'

// Runs against a real Postgres when TEST_DATABASE_URL is set; each run uses a throwaway schema.
const url = process.env.TEST_DATABASE_URL
const migration = readFileSync(new URL('../../../db/migrations/0001_init.sql', import.meta.url), 'utf8')
const migration3 = readFileSync(new URL('../../../db/migrations/0003_usage_alerts.sql', import.meta.url), 'utf8')
const migration2 = readFileSync(new URL('../../../db/migrations/0002_web_auth.sql', import.meta.url), 'utf8')
const migration6 = readFileSync(new URL('../../../db/migrations/0006_email_md5.sql', import.meta.url), 'utf8')
const schema =`t_delivery_${process.pid}_${Date.now()}`
const DID = 'did:plc:alice'
const HASH = 'a'.repeat(64)

describe.skipIf(!url)('postgres stores', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    await pool.query(migration)
    await pool.query(migration2)
    await pool.query(migration3)
    await pool.query(migration6)
  })

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })

  it('looks up email hashes and honors the opt-out', async () => {
    const index = new PgIndexStore(pool)
    await pool.query(`INSERT INTO email_links (email_hash, did, method) VALUES ($1, $2, 'code')`, [HASH, DID])
    expect(await index.didForEmailHash(HASH)).toBe(DID)
    expect(await index.visibility(DID)).toEqual({ keyedOnly: false, domainAllowlist: [], hiddenProfile: false, emailLookupOptOut: false })
    await pool.query(`INSERT INTO visibility_rules (did, domain_allowlist, email_lookup_opt_out) VALUES ($1, '{example.com}', true)`, [DID])
    expect(await index.didForEmailHash(HASH)).toBeNull()
    expect((await index.visibility(DID)).domainAllowlist).toEqual(['example.com'])
  })

  it('looks up MD5 hashes only for links that stored one, with the same opt-out', async () => {
    const index = new PgIndexStore(pool)
    const sha = 'b'.repeat(64)
    const md5 = 'c'.repeat(32)
    const did = 'did:plc:bob'
    await pool.query(`INSERT INTO email_links (email_hash, did, method) VALUES ($1, $2, 'code')`, [sha, did])
    // A link made before migration 0006 has no MD5, so only its SHA256 resolves.
    expect(await index.didForEmailHash(md5)).toBeNull()
    expect(await index.didForEmailHash(sha)).toBe(did)
    await pool.query(`UPDATE email_links SET email_md5 = $2 WHERE email_hash = $1`, [sha, md5])
    expect(await index.didForEmailHash(md5)).toBe(did)
    expect(await index.didForEmailHash(md5.toUpperCase())).toBe(did)
    await pool.query(`INSERT INTO visibility_rules (did, email_lookup_opt_out) VALUES ($1, true)`, [did])
    expect(await index.didForEmailHash(md5)).toBeNull()
    expect(await index.didForEmailHash(sha)).toBeNull()
  })

  it('applies migration 0006 twice and rejects a malformed or duplicate MD5', async () => {
    await pool.query(migration6)
    await expect(pool.query(`INSERT INTO email_links (email_hash, did, method, email_md5) VALUES ($1, 'did:plc:x', 'code', 'nothex')`, ['d'.repeat(64)])).rejects.toThrow()
    await pool.query(`INSERT INTO email_links (email_hash, did, method, email_md5) VALUES ($1, 'did:plc:x', 'code', $2)`, ['d'.repeat(64), 'e'.repeat(32)])
    await expect(pool.query(`INSERT INTO email_links (email_hash, did, method, email_md5) VALUES ($1, 'did:plc:y', 'code', $2)`, ['f'.repeat(64), 'e'.repeat(32)])).rejects.toThrow()
  })

  it('reads images, repo status, and blocks', async () => {
    const index = new PgIndexStore(pool)
    await pool.query(
      `INSERT INTO images (did, rkey, cid, mime_type, rating, is_default, created_at)
            VALUES ($1, 'r1', 'bafyone', 'image/png', 'pg', true, '2026-01-01T00:00:00Z')`,
      [DID],
    )
    expect(await index.serviceImages(DID)).toEqual([
      { rkey: 'r1', cid: 'bafyone', mimeType: 'image/png', rating: 'pg', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
    ])
    expect(await index.isRepoActive(DID)).toBe(true)
    await pool.query(`INSERT INTO repos (did, active, status) VALUES ($1, false, 'takendown')`, [DID])
    expect(await index.isRepoActive(DID)).toBe(false)
    expect(await index.isBlocked(DID, 'bafyone')).toBe(false)
    await pool.query(`INSERT INTO blocked_images (did, cid) VALUES ($1, 'bafyone')`, [DID])
    expect(await index.isBlocked(DID, 'bafyone')).toBe(true)
  })

  it('finds keys by SHA256 and ignores revoked keys', async () => {
    const licenses = new PgLicenseStore(pool)
    const raw = 'pk_test_123456'
    await pool.query(`INSERT INTO licenses (license_id, owner, tier) VALUES ('lic1', $1, 'pro')`, [DID])
    await pool.query(
      `INSERT INTO api_keys (key_hash, prefix, license_id, kind, domains) VALUES ($1, 'pk_test', 'lic1', 'publishable', '{*.example.com}')`,
      [hashApiKey(raw)],
    )
    const found = await licenses.findKey(raw)
    expect(found?.license).toEqual({ licenseId: 'lic1', owner: DID, tier: 'pro', status: 'active' })
    expect(found?.key).toEqual({ key: raw, kind: 'publishable', licenseId: 'lic1', domains: ['*.example.com'] })
    expect(await licenses.findKey('pk_other')).toBeNull()
    await pool.query(`UPDATE api_keys SET revoked_at = now()`)
    expect(await licenses.findKey(raw)).toBeNull()
  })

  it('counts rate windows and resets expired ones', async () => {
    const limiter = new PgRateLimiter(pool)
    const a = await limiter.hit('ip:1', 2, 60)
    const b = await limiter.hit('ip:1', 2, 60)
    const c = await limiter.hit('ip:1', 2, 60)
    expect([a.remaining, b.remaining, c.remaining]).toEqual([1, 0, 0])
    expect([a.exceeded, b.exceeded, c.exceeded]).toEqual([false, false, true])
    expect(a.reset).toBeGreaterThan(Date.now() / 1000)
    await pool.query(`UPDATE rate_windows SET reset_at = now() - interval '1 second'`)
    expect((await limiter.hit('ip:1', 2, 60)).remaining).toBe(1)
  })

  it('adds to monthly usage counters', async () => {
    const usage = new PgUsageMeter(pool)
    expect(await usage.add('lic1', 'origin_resolution')).toBe(1)
    expect(await usage.add('lic1', 'origin_resolution', 4)).toBe(5)
    const { rows } = await pool.query(`SELECT count FROM usage_counters WHERE license_id = 'lic1' AND meter = 'origin_resolution'`)
    expect(rows.map((r) => Number(r.count))).toEqual([5])
  })

  it('tracks service costs per DID and claims each alert once', async () => {
    const usage = new PgUsageMeter(pool)
    await usage.addService(DID, 'transform')
    await usage.addService(DID, 'bytes_delivered', 10)
    await usage.addService(DID, 'bytes_delivered', 5)
    const { rows } = await pool.query(`SELECT meter, count FROM service_usage_counters WHERE did = $1 ORDER BY meter`, [DID])
    expect(rows.map((r) => [r.meter, Number(r.count)])).toEqual([['bytes_delivered', 15], ['transform', 1]])
    const ledger = new PgAlertLedger(pool)
    expect(await ledger.claim('lic1', '2026-11-01', 80)).toBe(true)
    expect(await ledger.claim('lic1', '2026-11-01', 80)).toBe(false)
    expect(await ledger.claim('lic1', '2026-11-01', 100)).toBe(true)
  })
})
