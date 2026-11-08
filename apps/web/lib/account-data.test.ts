import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { confirmationMatches, deleteAccountData, DeletionBlocked, exportAccountData } from './account-data'
import { purgeImagePrefixes } from './cache-purge'
import { applyEvent } from './billing/webhook'
import { postgresBillingStore } from './billing/store'

describe('confirmationMatches', () => {
  it('accepts the phrase with case and spacing slack and nothing else', () => {
    expect(confirmationMatches(' Delete My Data ')).toBe(true)
    expect(confirmationMatches('delete')).toBe(false)
    expect(confirmationMatches('')).toBe(false)
  })
})

describe('purgeImagePrefixes', () => {
  const env = { CF_ZONE_ID: 'z', CF_API_TOKEN: 't', PUBLIC_DELIVERY_URL: 'https://img.example.com/' }
  it('sends prefixes in batches of 30 and reports failure without throwing', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    const cids = Array.from({ length: 31 }, (_, i) => `c${i}`)
    expect(await purgeImagePrefixes('did:plc:a', cids, env, f as unknown as typeof fetch)).toBe(true)
    expect(f).toHaveBeenCalledTimes(2)
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body).prefixes[0]).toBe('img.example.com/img/did%3Aplc%3Aa/c0/')
    const bad = vi.fn(async () => new Response('no', { status: 500 }))
    expect(await purgeImagePrefixes('did:plc:a', ['c'], env, bad as unknown as typeof fetch)).toBe(false)
    expect(await purgeImagePrefixes('did:plc:a', ['c'], {})).toBe(false)
  })
})

const url = process.env.TEST_DATABASE_URL
const schema = `t_acctdata_${process.pid}_${Date.now()}`
const A = 'did:plc:alice'
const B = 'did:plc:bob'
const H1 = 'a'.repeat(64)
const H2 = 'b'.repeat(64)
const HB = 'c'.repeat(64)

describe.skipIf(!url)('account data export and deletion', () => {
  let pool: pg.Pool
  const count = async (table: string, col: string, did: string) => (await pool.query(`SELECT count(*)::int AS c FROM ${table} WHERE ${col} = $1`, [did])).rows[0].c as number

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    const dir = new URL('../../../db/migrations/', import.meta.url)
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await pool.query(readFileSync(new URL(f, dir), 'utf8'))
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })

  async function seed(did: string, hash: string, tag: string) {
    const q = (sql: string, p: unknown[]) => pool.query(sql, p)
    await q("INSERT INTO email_links (email_hash, did, method, is_primary, email_domain) VALUES ($1, $2, 'code', true, 'example.com')", [hash, did])
    await q('INSERT INTO email_codes (did, email_hash, code_hash, masked, expires_at) VALUES ($1, $2, $3, $4, now() + interval \'10 minutes\')', [did, hash.replace(/^./, 'd'), 'f'.repeat(64), 'a***@e***.com'])
    await q('INSERT INTO notice_emails (did, email_hash, email_enc) VALUES ($1, $2, $3)', [did, hash, 'v1:secretblob'])
    await q('INSERT INTO oauth_session (sub, value) VALUES ($1, $2)', [did, 'v'])
    await q("INSERT INTO web_session (id, did, device) VALUES ($1, $2, 'Firefox on Linux')", [`s${tag}`, did])
    await q('INSERT INTO session_floor (did, revoked_at) VALUES ($1, now())', [did])
    await q('INSERT INTO oauth_state (key, value) VALUES ($1, $2)', [`state-${tag}`, 'v'])
    await q("INSERT INTO profile_links (did, rkey, cid, url) VALUES ($1, 'r1', 'cid', 'https://example.com')", [did])
    await q('INSERT INTO visibility_rules (did, hidden_profile) VALUES ($1, true)', [did])
    await q("INSERT INTO verification_state (state, did, rkey, provider) VALUES ($1, $2, 'r1', 'github')", [`vs-${tag}`, did])
    await q("INSERT INTO custom_domains (did, hostname, cf_id) VALUES ($1, $2, 'cf1')", [did, `${tag}.example.com`])
    await q("INSERT INTO profile_view_counters (did, day, views, json_calls) VALUES ($1, '2026-11-06', 5, 2)", [did])
    await q("INSERT INTO images (did, rkey, cid, mime_type, rating, created_at) VALUES ($1, 'i1', $2, 'image/png', 'g', now()), ($1, 'i2', $3, 'image/png', 'g', now())", [did, `bafy1${tag}`, `bafy2${tag}`])
    await q("INSERT INTO profiles (did, record) VALUES ($1, '{}')", [did])
    await q("INSERT INTO claims (did, rkey, record) VALUES ($1, 'c1', '{}')", [did])
    await q("INSERT INTO attestations (uri, cid, claim_did, claim_rkey, claim_cid, result) VALUES ($1, 'x', $2, 'c1', 'y', 'verified'), ($3, 'x', $2, 'c1', 'y', 'revoked')", [`at://svc/a/${tag}1`, did, `at://svc/a/${tag}2`])
    await q("INSERT INTO licenses (license_id, owner, tier) VALUES ($1, $2, 'plus')", [`lic_${tag}`, did])
    await q("INSERT INTO api_keys (key_hash, prefix, license_id, kind) VALUES ($1, 'bv_pk', $2, 'publishable')", [hash.replace(/^./, 'e'), `lic_${tag}`])
    await q("INSERT INTO usage_counters (license_id, meter, period_start, count) VALUES ($1, 'transform', '2026-11-01', 3)", [`lic_${tag}`])
    await q("INSERT INTO billing_customers (did, license_id, stripe_customer_id) VALUES ($1, $2, $3)", [did, `lic_${tag}`, `cus_${tag}`])
    await q("INSERT INTO subscriptions (stripe_subscription_id, stripe_customer_id, did, license_id, price_id, tier, status, last_event_at) VALUES ($1, $2, $3, $4, 'price', 'pro', 'active', now())", [`sub_${tag}`, `cus_${tag}`, did, `lic_${tag}`])
    await q("INSERT INTO stripe_events (event_id, type) VALUES ($1, 'x')", [`evt_${tag}`])
    const act = await pool.query("INSERT INTO admin_actions (actor, action, target_did, reason) VALUES ('did:plc:mod', 'takedown', $1, 'internal reason') RETURNING id", [did])
    await q("INSERT INTO appeals (did, action_id, statement, status, decided_by, decision_note, decided_at) VALUES ($1, $2, 'my statement', 'upheld', 'did:plc:mod2', 'internal note', now())", [did, act.rows[0].id])
  }

  it('exports every section for the DID only, masked and without secrets', async () => {
    await seed(A, H1, 'a')
    await seed(B, HB, 'b')
    await pool.query("INSERT INTO reports (target_did, source, reason, ip_hash) VALUES ($1, 'avatar', 'spam', 'h')", [A])
    const out = await exportAccountData(pool, A, new Date('2026-11-07T00:00:00Z'), () => 'jane@example.com')
    expect(out.did).toBe(A)
    expect(out.emails.primaryMasked).toBe('j***@e***.com')
    expect(out.emails.links).toHaveLength(1)
    expect(out.emails.links[0]).toMatchObject({ email_hash: H1, method: 'code', is_primary: true, email_domain: 'e***.com' })
    expect(out.profileLinks).toHaveLength(1)
    expect(out.claims).toHaveLength(1)
    expect(out.attestations).toHaveLength(2)
    expect(out.visibilityRules).toMatchObject({ hidden_profile: true })
    expect(out.licenses).toHaveLength(1)
    expect(out.apiKeys).toEqual([expect.objectContaining({ prefix: 'bv_pk', kind: 'publishable' })])
    expect(out.customDomain).toMatchObject({ hostname: 'a.example.com' })
    expect(out.billing.customers).toHaveLength(1)
    expect(out.billing.subscriptions).toHaveLength(1)
    expect(out.indexed.images).toHaveLength(2)
    expect(out.profileViews).toEqual([{ day: '2026-11-06', views: 5, jsonCalls: 2 }])
    const text = JSON.stringify(out)
    expect(text).not.toContain('jane@example.com')
    expect(text).not.toContain('key_hash')
    expect(text).not.toContain(HB)
    expect(text).not.toContain('spam')
    expect(text).not.toContain('secretblob')
    expect(out.appeals).toEqual([expect.objectContaining({ appealed_action: 'takedown', statement: 'my statement', status: 'upheld' })])
    expect(text).not.toContain('internal note')
    expect(text).not.toContain('internal reason')
    expect(text).not.toContain('did:plc:mod')
  })

  it('deletes every table for the DID, keeps billing rows marked, and leaves other users alone', async () => {
    const canceled: string[] = []
    const removed: string[] = []
    const purged: string[][] = []
    const hosts: string[] = []
    const s = await deleteAccountData(pool, A, {
      cancelSubscription: async (id) => void canceled.push(id),
      deleteHostname: async (id) => void hosts.push(id),
      removeAttestation: async (u) => void removed.push(u),
      purgeImages: async (_d, c) => void purged.push(c),
    })
    expect(s).toEqual({ emailLinksHeld: 1, images: 2, claims: 1, subscriptionsCanceled: 1 })
    expect(canceled).toEqual(['sub_a'])
    expect(hosts).toEqual(['cf1'])
    expect(removed).toEqual(['at://svc/a/a1'])
    expect(purged[0]!.sort()).toEqual(['bafy1a', 'bafy2a'])

    for (const [t, col] of [
      ['email_links', 'did'], ['email_codes', 'did'], ['notice_emails', 'did'], ['oauth_session', 'sub'], ['web_session', 'did'], ['session_floor', 'did'], ['profile_links', 'did'],
      ['visibility_rules', 'did'], ['verification_state', 'did'], ['custom_domains', 'did'], ['images', 'did'], ['profiles', 'did'],
      ['claims', 'did'], ['attestations', 'claim_did'], ['licenses', 'owner'], ['profile_view_counters', 'did'], ['appeals', 'did'],
    ] as const) expect(await count(t, col, A), t).toBe(0)
    expect((await pool.query("SELECT count(*)::int AS c FROM api_keys WHERE license_id = 'lic_a'")).rows[0].c).toBe(0)
    expect((await pool.query("SELECT count(*)::int AS c FROM usage_counters WHERE license_id = 'lic_a'")).rows[0].c).toBe(0)

    const hold = (await pool.query('SELECT did, reason FROM email_holds WHERE email_hash = $1', [H1])).rows[0]
    expect(hold).toEqual({ did: A, reason: 'account_deleted' })
    const cust = (await pool.query('SELECT deleted_at FROM billing_customers WHERE did = $1', [A])).rows[0]
    expect(cust.deleted_at).toBeInstanceOf(Date)
    const sub = (await pool.query('SELECT status, deleted_at FROM subscriptions WHERE did = $1', [A])).rows[0]
    expect(sub.status).toBe('canceled')
    expect(sub.deleted_at).toBeInstanceOf(Date)
    expect(await count('stripe_events', 'event_id', 'evt_a')).toBe(1)

    for (const [t, col] of [['email_links', 'did'], ['images', 'did'], ['licenses', 'owner'], ['claims', 'did'], ['custom_domains', 'did'], ['visibility_rules', 'did'], ['appeals', 'did']] as const) expect(await count(t, col, B), t).toBeGreaterThan(0)
    expect((await pool.query('SELECT deleted_at FROM subscriptions WHERE did = $1', [B])).rows[0].deleted_at).toBeNull()
  })

  it('is safe to run twice', async () => {
    const s = await deleteAccountData(pool, A)
    expect(s).toEqual({ emailLinksHeld: 0, images: 0, claims: 0, subscriptionsCanceled: 0 })
  })

  it('stops before deleting anything when Stripe or Cloudflare fails', async () => {
    await expect(deleteAccountData(pool, B, { cancelSubscription: async () => { throw new Error('stripe down') } })).rejects.toBeInstanceOf(DeletionBlocked)
    await expect(deleteAccountData(pool, B, { deleteHostname: async () => { throw new Error('cf down') } })).rejects.toBeInstanceOf(DeletionBlocked)
    expect(await count('email_links', 'did', B)).toBe(1)
    expect(await count('images', 'did', B)).toBe(2)
  })

  it('ignores late Stripe events for a deleted account until a new checkout', async () => {
    const store = postgresBillingStore(pool)
    const env = { STRIPE_PRICE_PRO: 'price_pro' }
    const sub = { id: 'sub_a', customer: 'cus_a', status: 'canceled', metadata: { did: A }, items: { data: [{ price: { id: 'price_pro' }, current_period_end: 1 }] } }
    const evt = (type: string, object: unknown) => ({ id: `evt_${type}`, type, created: 1_900_000_000, data: { object } }) as never
    await store.process('late1', 'customer.subscription.updated', async (tx) => {
      expect(await applyEvent(tx, evt('customer.subscription.updated', sub), new Date(), env)).toMatch(/deleted their data/)
    })
    expect(await count('licenses', 'owner', A)).toBe(0)
    await store.process('new1', 'checkout.session.completed', async (tx) => {
      await applyEvent(tx, evt('checkout.session.completed', { mode: 'subscription', customer: 'cus_a2', client_reference_id: A }), new Date(), env)
    })
    expect((await pool.query('SELECT deleted_at, stripe_customer_id FROM billing_customers WHERE did = $1', [A])).rows[0]).toEqual({ deleted_at: null, stripe_customer_id: 'cus_a2' })
  })
})
