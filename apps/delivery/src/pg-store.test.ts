import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkEntitlement } from './entitlement.js'
import { hashApiKey, PgAlertLedger, PgIndexStore, PgLicenseStore, PgRateLimiter, PgUsageMeter } from './pg-store.js'

// Runs against a real Postgres when TEST_DATABASE_URL is set; each run uses a throwaway schema.
const url = process.env.TEST_DATABASE_URL
const migration = readFileSync(new URL('../../../db/migrations/0001_init.sql', import.meta.url), 'utf8')
const migration3 = readFileSync(new URL('../../../db/migrations/0003_usage_alerts.sql', import.meta.url), 'utf8')
const migration2 = readFileSync(new URL('../../../db/migrations/0002_web_auth.sql', import.meta.url), 'utf8')
const migration7 = readFileSync(new URL('../../../db/migrations/0008_blocked_images.sql', import.meta.url), 'utf8')
const migration14 = readFileSync(new URL('../../../db/migrations/0014_gallery.sql', import.meta.url), 'utf8')
const migration29 = readFileSync(new URL('../../../db/migrations/0029_image_crop.sql', import.meta.url), 'utf8')
const migration15 = readFileSync(new URL('../../../db/migrations/0015_billing.sql', import.meta.url), 'utf8')
const migration16 = readFileSync(new URL('../../../db/migrations/0016_email_domain.sql', import.meta.url), 'utf8')
const migration17 = readFileSync(new URL('../../../db/migrations/0017_plus_subscriptions.sql', import.meta.url), 'utf8')
const migration24 = readFileSync(new URL('../../../db/migrations/0024_usage_daily.sql', import.meta.url), 'utf8')
const migration25 = readFileSync(new URL('../../../db/migrations/0025_profile_view_counters.sql', import.meta.url), 'utf8')
const migration26 = readFileSync(new URL('../../../db/migrations/0026_organizations.sql', import.meta.url), 'utf8')
const migration35 = readFileSync(new URL('../../../db/migrations/0035_api_key_expiry.sql', import.meta.url), 'utf8')
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
    await pool.query(migration7)
    await pool.query(migration14)
    await pool.query(migration29)
    await pool.query(migration15)
    await pool.query(migration16)
    await pool.query(migration17)
    await pool.query(migration24)
    await pool.query(migration25)
    await pool.query(migration26)
    await pool.query(migration35)
  }, 60_000)

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  }, 60_000)

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
      { rkey: 'r1', cid: 'bafyone', mimeType: 'image/png', rating: 'pg', isDefault: true, purpose: 'avatar', caption: null, sort: null, crop: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ])
    expect(await index.isRepoActive(DID)).toBe(true)
    await pool.query(`INSERT INTO repos (did, active, status) VALUES ($1, false, 'takendown')`, [DID])
    expect(await index.isRepoActive(DID)).toBe(false)
    expect(await index.isBlocked(DID, 'bafyone')).toBe(false)
    await pool.query(`INSERT INTO blocked_images (did, cid) VALUES ($1, 'bafyone')`, [DID])
    expect(await index.isBlocked(DID, 'bafyone')).toBe(true)
    await pool.query(`UPDATE blocked_images SET unblocked_at = now() WHERE did = $1`, [DID])
    expect(await index.isBlocked(DID, 'bafyone')).toBe(false)
  })

  it('reads the crop saved with an image and treats a missing or partial crop as the center crop', async () => {
    const index = new PgIndexStore(pool)
    const did = 'did:plc:cropper'
    const ins = (rkey: string, cid: string, crop: [number | null, number | null, number | null]) =>
      pool.query(
        `INSERT INTO images (did, rkey, cid, mime_type, rating, created_at, crop_x, crop_y, crop_size) VALUES ($1, $2, $3, 'image/png', 'g', now(), $4, $5, $6)`,
        [did, rkey, cid, ...crop],
      )
    await ins('c1', 'bafycropped', [1000, 2500, 6000])
    await ins('c2', 'bafyplain', [null, null, null])
    expect(await index.imageCrop(did, 'bafycropped')).toEqual({ x: 1000, y: 2500, size: 6000 })
    expect((await index.serviceImages(did)).find((i) => i.cid === 'bafycropped')?.crop).toEqual({ x: 1000, y: 2500, size: 6000 })
    expect(await index.imageCrop(did, 'bafyplain')).toBeNull()
    expect(await index.imageCrop(did, 'bafyunknown')).toBeNull()
    await expect(ins('c3', 'bafybad', [1, null, 5])).rejects.toThrow()
    await expect(ins('c4', 'bafybad2', [0, 0, 10001])).rejects.toThrow()
  })

  it('hasPlusSubscription follows status and the past-due grace period', async () => {
    const index = new PgIndexStore(pool)
    const did = 'did:plc:plussub'
    const t0 = new Date('2026-11-01T00:00:00Z')
    const day = 86_400_000
    await pool.query(`INSERT INTO licenses (license_id, owner, tier) VALUES ('lic_plus', $1, 'free')`, [did])
    const put = (status: string, pastDue: Date | null, tier = 'plus') =>
      pool.query(
        `INSERT INTO subscriptions (stripe_subscription_id, stripe_customer_id, did, license_id, price_id, tier, status, past_due_since, last_event_at)
              VALUES ('sub_plus', 'cus_plus', $1, 'lic_plus', 'price_plus', $4, $2, $3, now())
         ON CONFLICT (stripe_subscription_id) DO UPDATE SET status = EXCLUDED.status, past_due_since = EXCLUDED.past_due_since, tier = EXCLUDED.tier`,
        [did, status, pastDue, tier],
      )
    expect(await index.hasPlusSubscription(did, t0)).toBe(false)
    await put('active', null)
    expect(await index.hasPlusSubscription(did, t0)).toBe(true)
    await put('past_due', t0)
    expect(await index.hasPlusSubscription(did, new Date(t0.getTime() + 6 * day))).toBe(true)
    expect(await index.hasPlusSubscription(did, new Date(t0.getTime() + 8 * day))).toBe(false)
    await put('canceled', null)
    expect(await index.hasPlusSubscription(did, t0)).toBe(false)
    await put('active', null, 'pro')
    expect(await index.hasPlusSubscription(did, t0)).toBe(false)
  })

  it('keeps gallery images out of avatar reads and orders them by sort, unset last, then newest', async () => {
    const index = new PgIndexStore(pool)
    const did = 'did:plc:gal'
    const ins = (rkey: string, purpose: string, sort: number | null, at: string) =>
      pool.query(
        `INSERT INTO images (did, rkey, cid, mime_type, rating, purpose, caption, sort, created_at)
              VALUES ($1, $2, $3, 'image/png', 'g', $4, $5, $6, $7)`,
        [did, rkey, `cid-${rkey}`, purpose, `cap ${rkey}`, sort, at],
      )
    await ins('av', 'avatar', null, '2026-01-01T00:00:00Z')
    await ins('g-old', 'gallery', null, '2026-01-02T00:00:00Z')
    await ins('g-new', 'gallery', null, '2026-01-03T00:00:00Z')
    await ins('g-two', 'gallery', 2, '2026-01-01T00:00:00Z')
    await ins('g-one', 'gallery', 1, '2026-01-01T00:00:00Z')
    expect((await index.serviceImages(did)).map((i) => i.rkey)).toEqual(['av'])
    expect((await index.galleryImages(did)).map((i) => i.rkey)).toEqual(['g-one', 'g-two', 'g-new', 'g-old'])
    expect((await index.galleryImages(did))[0]).toMatchObject({ caption: 'cap g-one', sort: 1, purpose: 'gallery' })
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
    expect(found?.license).toEqual({ licenseId: 'lic1', owner: DID, tier: 'plus', status: 'active' })
    expect(found?.key).toEqual({ key: raw, kind: 'publishable', licenseId: 'lic1', domains: ['*.example.com'], expiresAt: null })
    expect(await licenses.findKey('pk_other')).toBeNull()
    await pool.query(`UPDATE api_keys SET revoked_at = now()`)
    expect(await licenses.findKey(raw)).toBeNull()
  })

  it('serves a past-due license at its paid tier during grace, then at Free, and still serves it (spec section 12)', async () => {
    const licenses = new PgLicenseStore(pool)
    const raw = 'pk_pastdue_1'
    await pool.query(`INSERT INTO licenses (license_id, owner, tier, status, grace_ends_at) VALUES ('lic_pd', 'did:plc:pd', 'business', 'past_due', now() + interval '1 day')`)
    await pool.query(`INSERT INTO api_keys (key_hash, prefix, license_id, kind) VALUES ($1, 'pk_past', 'lic_pd', 'publishable')`, [hashApiKey(raw)])
    expect((await licenses.findKey(raw))?.license).toMatchObject({ tier: 'business', status: 'past_due' })
    const info = { headerKey: undefined, tokenParam: raw, origin: undefined, referer: undefined, clientIp: '1.1.1.1' }
    const limiter = new PgRateLimiter(pool)
    expect(await checkEntitlement(info, licenses, limiter)).toMatchObject({ ok: true, tier: 'business' })
    await pool.query(`UPDATE licenses SET grace_ends_at = now() - interval '1 second' WHERE license_id = 'lic_pd'`)
    expect((await licenses.findKey(raw))?.license.tier).toBe('free')
    expect(await checkEntitlement(info, licenses, limiter)).toMatchObject({ ok: true, tier: 'free' })
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

  it('adds a batched increment to a rate window in one write', async () => {
    const limiter = new PgRateLimiter(pool)
    expect((await limiter.hit('ip:batch', 10, 60, 4)).remaining).toBe(6)
    expect((await limiter.hit('ip:batch', 10, 60, 7)).exceeded).toBe(true)
    await pool.query(`UPDATE rate_windows SET reset_at = now() - interval '1 second'`)
    expect((await limiter.hit('ip:batch', 10, 60, 3)).remaining).toBe(7)
  })

  it('adds to monthly usage counters', async () => {
    const usage = new PgUsageMeter(pool)
    expect(await usage.add('lic1', 'origin_resolution')).toBe(1)
    expect(await usage.add('lic1', 'origin_resolution', 4)).toBe(5)
    const { rows } = await pool.query(`SELECT count FROM usage_counters WHERE license_id = 'lic1' AND meter = 'origin_resolution'`)
    expect(rows.map((r) => Number(r.count))).toEqual([5])
  })

  it('records day rows for origin resolutions and profile JSON, and reads them back', async () => {
    const usage = new PgUsageMeter(pool)
    await pool.query(`INSERT INTO licenses (license_id, owner, tier) VALUES ('licd', 'did:plc:d', 'pro')`)
    await usage.add('licd', 'origin_resolution', 2)
    await usage.add('licd', 'origin_resolution')
    await usage.add('licd', 'profile_json')
    await usage.add('licd', 'transform', 5)
    const today = new Date().toISOString().slice(0, 10)
    const period = `${today.slice(0, 7)}-01`
    const snap = await usage.read('licd', [period], [today, '2000-01-01'])
    expect(Object.fromEntries(snap.monthly)).toEqual({ [`${period}|origin_resolution`]: 3, [`${period}|profile_json`]: 1, [`${period}|transform`]: 5 })
    expect(Object.fromEntries(snap.daily)).toEqual({ [`${today}|origin_resolution`]: 3, [`${today}|profile_json`]: 1 })
    expect(await usage.read('licd', [], [])).toEqual({ monthly: new Map(), daily: new Map() })
    await pool.query(`DELETE FROM licenses WHERE license_id = 'licd'`)
    expect((await pool.query(`SELECT count(*)::int AS c FROM usage_daily WHERE license_id = 'licd'`)).rows[0].c).toBe(0)
  })

  it('upserts keyed profile JSON calls into one daily row per DID', async () => {
    const usage = new PgUsageMeter(pool)
    await Promise.all([usage.addProfileCall(DID), usage.addProfileCall(DID), usage.addProfileCall(DID)])
    const { rows } = await pool.query(`SELECT views, json_calls FROM profile_view_counters WHERE did = $1`, [DID])
    expect(rows.map((r) => [Number(r.views), Number(r.json_calls)])).toEqual([[0, 3]])
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
