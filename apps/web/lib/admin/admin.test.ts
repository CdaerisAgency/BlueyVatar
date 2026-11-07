import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ADMIN_SESSION_TTL_MS, adminDids, adminEnabled, isAdminDid } from './config'
import { accountSummary, cleanReason, dismissReport, listActions, listReports, suspend, takedown, unblockImage, unsuspend } from './moderation'
import { purgerFromEnv } from './purge'
import { consumeTotp, createAdminSession, readAdminSession, revokeAdminSession } from './session'
import { base32Decode, codeFor, matchStep, stepAt } from './totp'

describe('totp', () => {
  // RFC 6238 appendix B test secret "12345678901234567890", SHA-1: T=59 gives 94287082, so its 6-digit form is 287082.
  const secret = Buffer.from('12345678901234567890')
  const b32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  it('matches the RFC 6238 vector', () => {
    expect(base32Decode(b32).equals(secret)).toBe(true)
    expect(codeFor(secret, 1)).toBe('287082')
  })
  it('accepts one step of drift and rejects the rest', () => {
    const now = 1_700_000_000_000
    const step = stepAt(now)
    expect(matchStep(b32, codeFor(secret, step), now)).toBe(step)
    expect(matchStep(b32, codeFor(secret, step - 1), now)).toBe(step - 1)
    expect(matchStep(b32, codeFor(secret, step - 3), now)).toBeNull()
    expect(matchStep(b32, '12345', now)).toBeNull()
    expect(matchStep(b32, 'abcdef', now)).toBeNull()
  })
})

describe('admin config', () => {
  it('needs both an allowlist and a secret', () => {
    expect(adminEnabled({})).toBe(false)
    expect(adminEnabled({ ADMIN_DIDS: 'did:plc:a' })).toBe(false)
    expect(adminEnabled({ ADMIN_DIDS: 'did:plc:a', ADMIN_TOTP_SECRET: 'X' })).toBe(true)
  })
  it('parses the allowlist and ignores junk', () => {
    const env = { ADMIN_DIDS: 'did:plc:a, did:web:b.test nope' }
    expect(adminDids(env)).toEqual(['did:plc:a', 'did:web:b.test'])
    expect(isAdminDid('did:plc:a', env)).toBe(true)
    expect(isAdminDid('did:plc:c', env)).toBe(false)
    expect(isAdminDid(null, env)).toBe(false)
  })
})

describe('purgerFromEnv', () => {
  it('returns false without settings and posts prefixes with them', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    expect(await purgerFromEnv({}, f as unknown as typeof fetch)('did:plc:a', ['c'])).toBe(false)
    expect(f).not.toHaveBeenCalled()
    const env = { CF_ZONE_ID: 'z', CF_API_TOKEN: 't', PUBLIC_DELIVERY_URL: 'https://x.test/' }
    expect(await purgerFromEnv(env, f as unknown as typeof fetch)('did:plc:a', ['c1']))
      .toBe(true)
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ prefixes: ['x.test/img/did%3Aplc%3Aa/c1/'] })
    const bad = vi.fn(async () => new Response('no', { status: 500 }))
    expect(await purgerFromEnv(env, bad as unknown as typeof fetch)('did:plc:a', ['c1'])).toBe(false)
  })
})

describe('cleanReason', () => {
  it('requires a reason within the limit', () => {
    expect(cleanReason('  ok ')).toBe('ok')
    expect(cleanReason('')).toBeNull()
    expect(cleanReason('x'.repeat(501))).toBeNull()
  })
})

const url = process.env.TEST_DATABASE_URL
const schema = `t_admin_${process.pid}_${Date.now()}`
const sql = (f: string) => readFileSync(new URL(`../../../../db/migrations/${f}`, import.meta.url), 'utf8')

describe.skipIf(!url)('admin database operations', () => {
  let pool: pg.Pool
  const purge = vi.fn(async () => true)
  const A = 'did:plc:admin1'
  const T = 'did:plc:target'
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    const dir = new URL('../../../../db/migrations/', import.meta.url)
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await pool.query(sql(f))
    for (const [rkey, cid] of [['a', 'bafyaaaaaaaaaa'], ['b', 'bafybbbbbbbbbb']])
      await pool.query(`INSERT INTO images (did, rkey, cid, mime_type, rating, created_at) VALUES ($1, $2, $3, 'image/png', 'g', now())`, [T, rkey, cid])
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })
  const report = async (did = T) =>
    Number((await pool.query(`INSERT INTO reports (target_did, source, reason, ip_hash, reporter_contact) VALUES ($1, 'profile', 'spam', 'h', 'r@x.test') RETURNING id`, [did])).rows[0].id)

  it('sessions: live, bound to the DID, expiring, revocable', async () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const t = await createAdminSession(pool, A, now)
    expect(await readAdminSession(pool, t, A, now)).toBe(A)
    expect(await readAdminSession(pool, t, 'did:plc:other', now)).toBeNull()
    expect(await readAdminSession(pool, undefined, A, now)).toBeNull()
    expect(await readAdminSession(pool, 'wrong', A, now)).toBeNull()
    expect(await readAdminSession(pool, t, A, new Date(now.getTime() + ADMIN_SESSION_TTL_MS + 1))).toBeNull()
    await revokeAdminSession(pool, t, now)
    expect(await readAdminSession(pool, t, A, now)).toBeNull()
    const stored = await pool.query('SELECT token_hash FROM admin_sessions')
    expect(JSON.stringify(stored.rows)).not.toContain(t)
  })

  it('totp codes work once', async () => {
    const b32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    const now = new Date()
    const code = codeFor(base32Decode(b32), stepAt(now.getTime()))
    expect(await consumeTotp(pool, A, b32, 'bad', now)).toBe(false)
    expect(await consumeTotp(pool, A, b32, code, now)).toBe(true)
    expect(await consumeTotp(pool, A, b32, code, now)).toBe(false)
  })

  it('dismisses an open report once, with an audit row, and hides the reporter contact', async () => {
    const id = await report()
    expect((await listReports(pool, 'open')).find((r) => r.id === id)).toMatchObject({ has_contact: true })
    expect(JSON.stringify(await listReports(pool, 'all'))).not.toContain('r@x.test')
    expect(await dismissReport(pool, A, id, 'not abuse')).toEqual({ ok: true, purged: true })
    expect((await dismissReport(pool, A, id, 'again')).ok).toBe(false)
    expect((await pool.query('SELECT status, actioned_by, action_reason FROM reports WHERE id = $1', [id])).rows[0]).toEqual({ status: 'dismissed', actioned_by: A, action_reason: 'not abuse' })
    expect((await listActions(pool, { did: T }))[0]).toMatchObject({ actor: A, action: 'dismiss_report', report_id: id, reason: 'not abuse' })
  })

  it('suspend blocks images, lifts only suspension blocks, and keeps takedowns', async () => {
    purge.mockClear()
    expect(await suspend(pool, purge, A, T, 'investigating')).toEqual({ ok: true, purged: true, blocked: 2 })
    expect(purge).toHaveBeenCalledWith(T, expect.arrayContaining(['bafyaaaaaaaaaa', 'bafybbbbbbbbbb']))
    expect((await suspend(pool, purge, A, T, 'twice')).ok).toBe(false)
    expect((await accountSummary(pool, T)).suspension?.reason).toBe('investigating')
    // A takedown while suspended turns the blocks into takedown blocks, so lifting the suspension leaves them.
    await pool.query(`UPDATE blocked_images SET kind = 'takedown' WHERE did = $1 AND cid = 'bafybbbbbbbbbb'`, [T])
    expect(await unsuspend(pool, purge, A, T, 'cleared')).toEqual({ ok: true, purged: true, restored: 1 })
    const active = await pool.query('SELECT cid FROM blocked_images WHERE did = $1 AND unblocked_at IS NULL', [T])
    expect(active.rows).toEqual([{ cid: 'bafybbbbbbbbbb' }])
    expect((await unsuspend(pool, purge, A, T, 'again')).ok).toBe(false)
    expect((await accountSummary(pool, T)).suspension).toBeNull()
  })

  it('a later suspension does not downgrade a takedown block', async () => {
    expect((await suspend(pool, purge, A, T, 'again')).ok).toBe(true)
    const kinds = await pool.query('SELECT cid, kind FROM blocked_images WHERE did = $1 AND unblocked_at IS NULL ORDER BY cid', [T])
    expect(kinds.rows).toEqual([{ cid: 'bafyaaaaaaaaaa', kind: 'suspension' }, { cid: 'bafybbbbbbbbbb', kind: 'takedown' }])
    await unsuspend(pool, purge, A, T, 'done')
  })

  it('takedown blocks all images, actions the report, and audits; failed purge is reported', async () => {
    const id = await report()
    const failing = vi.fn(async () => false)
    expect(await takedown(pool, failing, A, T, 'illegal', id)).toEqual({ ok: true, purged: false, blocked: 2 })
    expect((await pool.query('SELECT status FROM reports WHERE id = $1', [id])).rows[0].status).toBe('actioned')
    const acts = await listActions(pool, { did: T })
    expect(acts[0]).toMatchObject({ action: 'takedown', report_id: id, actor: A })
    expect((await takedown(pool, purge, A, 'nope', 'x')).ok).toBe(false)
  })

  it('unblocks one image with an audit row', async () => {
    expect((await unblockImage(pool, purge, A, T, 'bafyaaaaaaaaaa', 'appeal upheld')).ok).toBe(true)
    expect((await unblockImage(pool, purge, A, T, 'bafyaaaaaaaaaa', 'again')).ok).toBe(false)
    expect((await listActions(pool, { did: T }))[0]).toMatchObject({ action: 'unblock_image', target_cid: 'bafyaaaaaaaaaa' })
  })

  it('summarizes an account', async () => {
    await pool.query(`INSERT INTO repos (did, handle, active, status) VALUES ($1, 't.test', true, 'active')`, [T])
    const s = await accountSummary(pool, T)
    expect(s.repo).toEqual({ handle: 't.test', active: true, status: 'active' })
    expect(s.images).toHaveLength(2)
    expect(s.blocked.map((b) => b.cid)).toEqual(['bafybbbbbbbbbb'])
    expect(s.reports.total).toBe(2)
    expect(s.actions.length).toBeGreaterThan(3)
    expect((await accountSummary(pool, 'did:plc:nobody')).repo).toBeNull()
  })
})
