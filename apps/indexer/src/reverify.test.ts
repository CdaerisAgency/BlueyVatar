import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Fetcher } from '@blueyvatar/core/verification'
import {
  DAY_MS, MAX_FAILS, pgReverifyStore, reverifyDue, scheduleReverify,
  type DueClaim, type ReverifyStore, type Verifier,
} from './reverify.js'
import { randomBytes } from 'node:crypto'
import { encryptJson } from '@blueyvatar/core/verification'
import { emailNotice, makeVerifier, pgRecipientLookup } from './reverify-wiring.js'

type Row = DueClaim & { verifiedAt: Date; lastCheckedAt: Date | null; result: 'verified' | 'revoked' }

function memoryStore(rows: Row[]): ReverifyStore {
  const by = (uri: string) => rows.find((r) => r.uri === uri)!
  return {
    async due(vb, cb, limit) {
      return rows.filter((r) => r.result === 'verified' && r.verifiedAt < vb && (!r.lastCheckedAt || r.lastCheckedAt < cb)).slice(0, limit)
    },
    async recordSuccess(uri, at) { Object.assign(by(uri), { verifiedAt: at, lastCheckedAt: at, failCount: 0 }) },
    async recordFailure(uri, at) { const r = by(uri); r.lastCheckedAt = at; return ++r.failCount },
    async recordInconclusive(uri, at) { by(uri).lastCheckedAt = at },
    async markRevoked(uri) { by(uri).result = 'revoked' },
  }
}

const T0 = new Date('2026-12-01T00:00:00Z')
const row = (n: number, over: Partial<Row> = {}): Row => ({
  uri: `at://did:plc:svc/com.blueyvatar.attestation/${n}`, did: `did:plc:u${n}`, rkey: 'c', method: 'rel-me', platform: 'website',
  claimUri: `https://site${n}.example/`, handle: `u${n}.test`, failCount: 0,
  verifiedAt: new Date(T0.getTime() - 31 * DAY_MS), lastCheckedAt: null, result: 'verified', ...over,
})

function harness(rows: Row[], verify: Verifier) {
  let clock = T0.getTime()
  const removed: string[] = []
  const notices: string[] = []
  const deps = {
    store: memoryStore(rows), verify,
    remove: async (u: string) => { removed.push(u) },
    onRevoked: async (c: DueClaim) => { notices.push(c.claimUri) },
  }
  const sleeps: number[] = []
  const opts = { now: () => new Date(clock), sleep: async (ms: number) => { sleeps.push(ms) }, batchDelayMs: 7 }
  return { rows, removed, notices, sleeps, run: () => reverifyDue(deps, opts), advance: (ms: number) => { clock += ms } }
}

describe('reverifyDue', () => {
  it('skips claims verified within the window and revoked ones', async () => {
    const verify = vi.fn<Verifier>(async () => ({ ok: true }))
    const h = harness([row(1, { verifiedAt: new Date(T0.getTime() - 29 * DAY_MS) }), row(2, { result: 'revoked' }), row(3)], verify)
    const r = await h.run()
    expect(r).toMatchObject({ checked: 1, ok: 1 })
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('success resets fail_count and restarts the 30 day window', async () => {
    const h = harness([row(1, { failCount: 2 })], async () => ({ ok: true }))
    await h.run()
    expect(h.rows[0]).toMatchObject({ failCount: 0, verifiedAt: T0, result: 'verified' })
    h.advance(DAY_MS)
    expect((await h.run()).checked).toBe(0)
  })

  it('revokes on the third consecutive failure: deletes the record, marks the row, notifies once', async () => {
    const h = harness([row(1)], async () => ({ ok: false, reason: 'No link' }))
    await h.run()
    expect(h.rows[0]).toMatchObject({ failCount: 1, result: 'verified' })
    h.advance(DAY_MS)
    await h.run()
    expect(h.rows[0]).toMatchObject({ failCount: 2, result: 'verified' })
    expect(h.removed).toEqual([])
    h.advance(DAY_MS)
    const r = await h.run()
    expect(r.revoked).toBe(1)
    expect(h.rows[0]).toMatchObject({ failCount: MAX_FAILS, result: 'revoked' })
    expect(h.removed).toEqual([h.rows[0]!.uri])
    expect(h.notices).toEqual(['https://site1.example/'])
    h.advance(DAY_MS)
    await h.run()
    expect(h.notices).toHaveLength(1)
    expect(h.removed).toHaveLength(1)
  })

  it('a success between failures breaks the streak', async () => {
    const results = [false, false, true, false, false]
    let i = 0
    const h = harness([row(1)], async () => (results[i++] ? { ok: true } : { ok: false, reason: 'x' }))
    for (let d = 0; d < 5; d++) { await h.run(); h.advance(31 * DAY_MS) }
    expect(h.rows[0]).toMatchObject({ failCount: 2, result: 'verified' })
    expect(h.removed).toEqual([])
  })

  it('does not count a pass twice inside the minimum gap', async () => {
    const h = harness([row(1)], async () => ({ ok: false, reason: 'x' }))
    await h.run()
    h.advance(3_600_000)
    await h.run()
    expect(h.rows[0]!.failCount).toBe(1)
  })

  it('transient failures never count', async () => {
    const h = harness([row(1, { failCount: 2 })], async () => ({ ok: false, reason: 'busy', transient: true }))
    const r = await h.run()
    expect(r).toMatchObject({ inconclusive: 1, failed: 0, revoked: 0 })
    expect(h.rows[0]).toMatchObject({ failCount: 2, result: 'verified' })
    expect(h.rows[0]!.lastCheckedAt).toEqual(T0)
  })

  it('keeps the row verified and retries when the repo delete fails', async () => {
    const rows = [row(1, { failCount: 2 })]
    let fail = true
    const deps = {
      store: memoryStore(rows), verify: (async () => ({ ok: false, reason: 'x' })) as Verifier,
      remove: async () => { if (fail) throw new Error('pds down') },
      onRevoked: async () => {},
    }
    let t = T0.getTime()
    const opts = { now: () => new Date(t), sleep: async () => {} }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await reverifyDue(deps, opts)
    expect(rows[0]).toMatchObject({ result: 'verified', failCount: 3 })
    fail = false
    t += DAY_MS
    expect((await reverifyDue(deps, opts)).revoked).toBe(1)
    expect(rows[0]!.result).toBe('revoked')
  })

  it('works in batches of 50 with a delay between them', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => row(i))
    const h = harness(rows, async () => ({ ok: true }))
    const r = await h.run()
    expect(r.checked).toBe(120)
    expect(h.sleeps).toEqual([7, 7])
  })

  it('a notice failure does not undo the revocation', async () => {
    const rows = [row(1, { failCount: 2 })]
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await reverifyDue(
      { store: memoryStore(rows), verify: async () => ({ ok: false, reason: 'x' }), remove: async () => {}, onRevoked: async () => { throw new Error('resend down') } },
      { now: () => T0, sleep: async () => {} },
    )
    expect(rows[0]!.result).toBe('revoked')
  })
})

describe('scheduleReverify', () => {
  it('runs on the interval and never overlaps itself', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const run = vi.fn(() => new Promise<{ checked: number; ok: number; failed: number; inconclusive: number; revoked: number }>((r) => { release = () => r({ checked: 0, ok: 0, failed: 0, inconclusive: 0, revoked: 0 }) }))
    const t = scheduleReverify(run, 24 * 3_600_000)
    await vi.advanceTimersByTimeAsync(24 * 3_600_000)
    await vi.advanceTimersByTimeAsync(24 * 3_600_000)
    expect(run).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(24 * 3_600_000)
    expect(run).toHaveBeenCalledTimes(2)
    clearInterval(t)
    vi.useRealTimers()
  })
})

const fetcher = (status: number, text = '', headers: Record<string, string> = { 'content-type': 'text/html' }): Fetcher =>
  async (url) => ({ status, url, text, headers })
const claim = (over: Partial<DueClaim>): DueClaim => ({ ...row(1), ...over })

describe('makeVerifier', () => {
  const pub = 'https://blueyvatar.test'
  it('rel-me: same check as the claims page', async () => {
    const page = '<a rel="me" href="https://blueyvatar.test/p/u1.test">me</a>'
    expect(await makeVerifier(pub, fetcher(200, page))(claim({}))).toEqual({ ok: true })
    const gone = await makeVerifier(pub, fetcher(200, '<p>nothing</p>'))(claim({}))
    expect(gone).toMatchObject({ ok: false })
    expect((gone as { transient?: boolean }).transient).toBeUndefined()
    expect(await makeVerifier(pub, fetcher(503))(claim({}))).toMatchObject({ ok: false, transient: true })
    expect(await makeVerifier(pub, fetcher(404))(claim({}))).toMatchObject({ ok: false })
    expect(await makeVerifier(pub, fetcher(200, page))(claim({ handle: null }))).toMatchObject({ transient: true })
  })
  it('github: 404 fails, rate limits are inconclusive', async () => {
    const c = claim({ method: 'github-oauth', claimUri: 'https://github.com/alice' })
    expect(await makeVerifier(pub, fetcher(200, '{}'))(c)).toEqual({ ok: true })
    expect(await makeVerifier(pub, fetcher(404))(c)).toMatchObject({ ok: false })
    expect(await makeVerifier(pub, fetcher(403))(c)).toMatchObject({ transient: true })
  })
  it('mastodon: profile url must still match', async () => {
    const c = claim({ method: 'mastodon-oauth', claimUri: 'https://social.example/@bob' })
    const good = JSON.stringify({ url: 'https://social.example/@bob' })
    expect(await makeVerifier(pub, fetcher(200, good))(c)).toEqual({ ok: true })
    expect(await makeVerifier(pub, fetcher(200, JSON.stringify({ url: 'https://social.example/@other' })))(c)).toMatchObject({ ok: false })
    expect(await makeVerifier(pub, fetcher(404))(c)).toMatchObject({ ok: false })
    expect(await makeVerifier(pub, fetcher(500))(c)).toMatchObject({ transient: true })
  })
})

describe('makeVerifier, proofs and provider claims', () => {
  const pub = 'https://blueyvatar.test'
  it('dns-txt re-runs the TXT check for the claim owner', async () => {
    const c = claim({ method: 'dns-txt', claimUri: 'https://example.com', did: 'did:plc:u1' })
    expect(await makeVerifier(pub, fetcher(200), async () => [['blueyvatar-verify=did:plc:u1']])(c)).toEqual({ ok: true })
    expect(await makeVerifier(pub, fetcher(200), async () => [])(c)).toMatchObject({ ok: false })
  })
  it('bsky-proof re-reads the public profile', async () => {
    const c = claim({ method: 'bsky-proof', claimUri: 'https://bsky.app/profile/x.test', did: 'did:plc:u1' })
    expect(await makeVerifier(pub, fetcher(200, JSON.stringify({ did: 'did:plc:z', description: 'blueyvatar-verify=did:plc:u1' })))(c)).toEqual({ ok: true })
    expect(await makeVerifier(pub, fetcher(200, JSON.stringify({ did: 'did:plc:z', description: '' })))(c)).toMatchObject({ ok: false })
    expect(await makeVerifier(pub, fetcher(500))(c)).toMatchObject({ transient: true })
  })
  it('provider claims check the public page: only gone fails', async () => {
    for (const m of ['instagram-oauth', 'threads-oauth', 'tiktok-oauth', 'youtube-oauth', 'twitch-oauth']) {
      const c = claim({ method: m, claimUri: 'https://www.twitch.tv/alice' })
      expect(await makeVerifier(pub, fetcher(200))(c)).toEqual({ ok: true })
      expect(await makeVerifier(pub, fetcher(404))(c)).toMatchObject({ ok: false })
      expect((await makeVerifier(pub, fetcher(403))(c)) as { transient?: boolean }).toMatchObject({ transient: true })
    }
  })
})

describe('emailNotice', () => {
  it('sends one message when an address exists, and nothing when it does not', async () => {
    const sent: { to: string; subject: string; text: string }[] = []
    const sender = { send: async (m: { to: string; subject: string; text: string }) => { sent.push(m) } }
    await emailNotice(sender, async () => 'a@b.test', 'https://blueyvatar.test/')(claim({}), 'No link')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toContain('https://blueyvatar.test/account/claims')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await emailNotice(sender, async () => null, 'https://x')(claim({}), 'r')
    expect(sent).toHaveLength(1)
  })
})

describe('pgRecipientLookup', () => {
  const key = randomBytes(32)
  const poolWith = (enc?: string) => ({ query: async () => ({ rows: enc ? [{ email_enc: enc }] : [] }) }) as never
  it('decrypts the stored primary email and returns null when none is stored', async () => {
    expect(await pgRecipientLookup(poolWith(encryptJson('who@x.test', key)), key)('did:plc:u')).toBe('who@x.test')
    expect(await pgRecipientLookup(poolWith(), key)('did:plc:u')).toBeNull()
  })
  it('returns null without logging the address when the key is wrong', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await pgRecipientLookup(poolWith(encryptJson('who@x.test', key)), randomBytes(32))('did:plc:u')).toBeNull()
    expect(JSON.stringify(err.mock.calls)).not.toContain('who@x.test')
  })
  it('a revoked claim mails the stored address through the revocation notice', async () => {
    const sent: { to: string; subject: string; text: string }[] = []
    const sender = { send: async (m: { to: string; subject: string; text: string }) => { sent.push(m) } }
    const lookup = pgRecipientLookup(poolWith(encryptJson('who@x.test', key)), key)
    const h = harness([row(1, { failCount: MAX_FAILS - 1 })], async () => ({ ok: false, reason: 'No link' }))
    await reverifyDue({ store: memoryStore(h.rows), verify: async () => ({ ok: false, reason: 'No link' }), remove: async () => {}, onRevoked: emailNotice(sender, lookup, 'https://blueyvatar.test') }, { now: () => T0, sleep: async () => {} })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('who@x.test')
  })
})

const url = process.env.TEST_DATABASE_URL
const schema = `t_reverify_${process.pid}_${Date.now()}`
const sql = (f: string) => readFileSync(new URL(`../../../db/migrations/${f}`, import.meta.url), 'utf8')

describe.skipIf(!url)('pgReverifyStore', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    for (const f of ['0001_init.sql', '0004_verification.sql', '0011_reverify.sql']) await pool.query(sql(f))
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })

  it('selects, counts, resets, and revokes', async () => {
    const old = new Date(T0.getTime() - 40 * DAY_MS)
    await pool.query(`INSERT INTO repos (did, handle) VALUES ('did:plc:a', 'a.test')`)
    await pool.query(`INSERT INTO claims (did, rkey, platform, uri, record) VALUES ('did:plc:a','c1','website','https://a.example/','{}'), ('did:plc:a','c2','website','https://b.example/','{}'), ('did:plc:a','c3','website','https://c.example/','{}')`)
    await pool.query(
      `INSERT INTO attestations (uri, cid, claim_did, claim_rkey, claim_cid, claim_uri, result, method, created_at, verified_at) VALUES
       ('at://s/x/1','c','did:plc:a','c1','cc','https://a.example/','verified','rel-me',$1,$1),
       ('at://s/x/2','c','did:plc:a','c2','cc','https://stale.example/','verified','rel-me',$1,$1),
       ('at://s/x/3','c','did:plc:a','c3','cc','https://c.example/','verified','rel-me',now(),now())`,
      [old],
    )
    const s = pgReverifyStore(pool)
    const cutoff = new Date(T0.getTime() - 30 * DAY_MS)
    const gap = new Date(T0.getTime() - 20 * 3_600_000)
    const due = await s.due(cutoff, gap, 50)
    expect(due.map((d) => d.uri)).toEqual(['at://s/x/1'])
    expect(due[0]).toMatchObject({ handle: 'a.test', platform: 'website', method: 'rel-me', failCount: 0 })
    expect(await s.recordFailure('at://s/x/1', T0)).toBe(1)
    expect(await s.recordFailure('at://s/x/1', T0)).toBe(2)
    expect(await s.due(cutoff, gap, 50)).toEqual([])
    await s.recordSuccess('at://s/x/1', T0)
    const r = await pool.query(`SELECT fail_count, verified_at FROM attestations WHERE uri = 'at://s/x/1'`)
    expect(r.rows[0]).toMatchObject({ fail_count: 0, verified_at: T0 })
    await s.markRevoked('at://s/x/1')
    expect((await pool.query(`SELECT result FROM attestations WHERE uri = 'at://s/x/1'`)).rows[0].result).toBe('revoked')
  })
})
