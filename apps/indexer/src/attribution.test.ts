import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ATTRIBUTION_SNIPPET, checkAttribution, type AttributionResult, type Fetcher } from '@blueyvatar/core/verification'
import { checkAttributionDue, notifyWith, pgAttributionStore, type AttributionStore, type DueSite } from './attribution.js'

type Row = DueSite & { result: AttributionResult | null; checkedAt: Date | null }

function memoryStore(rows: Row[]): AttributionStore {
  const by = (h: string) => rows.find((r) => r.hash === h)!
  return {
    async due(before, limit) {
      return rows.filter((r) => !r.checkedAt || r.checkedAt < before).slice(0, limit)
    },
    async record(h, result, at) {
      const r = by(h)
      r.result = result
      r.checkedAt = at
      if (result === 'found') r.notified = false
    },
    async markNotified(h) { by(h).notified = true },
  }
}

const T0 = new Date('2026-12-01T00:00:00Z')
const row = (n: number, over: Partial<Row> = {}): Row => ({ hash: `h${n}`, did: `did:plc:u${n}`, site: `https://site${n}.example/`, notified: false, result: null, checkedAt: null, ...over })
const pages: Record<string, { status: number; text: string }> = {
  'https://site1.example/': { status: 200, text: `<footer>${ATTRIBUTION_SNIPPET}</footer>` },
  'https://site2.example/': { status: 200, text: '<p>no link here</p>' },
  'https://site3.example/': { status: 200, text: '<a rel="nofollow" href="https://blueyvatar.com">x</a>' },
  'https://site4.example/': { status: 503, text: '' },
}
const fixtureFetch: Fetcher = async (url) => {
  const p = pages[url]
  if (!p) throw new Error('no route')
  return { status: p.status, url, text: p.text, headers: {} }
}

function harness(rows: Row[], notifyOk = true) {
  const notices: Array<[string, string]> = []
  const deps = {
    store: memoryStore(rows),
    check: (s: string) => checkAttribution(s, fixtureFetch),
    notify: async (c: DueSite, r: 'nofollow' | 'missing') => { notices.push([c.hash, r]); return notifyOk },
  }
  return { notices, run: () => checkAttributionDue(deps, { now: () => T0, sleep: async () => {} }) }
}

describe('checkAttributionDue', () => {
  it('records each result and tells the owner once per failure', async () => {
    const rows = [row(1), row(2), row(3), row(4)]
    const h = harness(rows)
    const r = await h.run()
    expect(r).toEqual({ checked: 4, found: 1, failed: 2, unreachable: 1, notified: 2 })
    expect(rows.map((x) => x.result)).toEqual(['found', 'missing', 'nofollow', 'unreachable'])
    expect(h.notices).toEqual([['h2', 'missing'], ['h3', 'nofollow']])
    expect(rows.every((x) => x.checkedAt?.getTime() === T0.getTime())).toBe(true)
  })

  it('does not notify again while the streak continues, and re-arms after a find', async () => {
    const rows = [row(2, { notified: true })]
    const h = harness(rows)
    await h.run()
    expect(h.notices).toEqual([])
    pages['https://site2.example/'] = { status: 200, text: ATTRIBUTION_SNIPPET }
    rows[0]!.checkedAt = null
    await h.run()
    expect(rows[0]).toMatchObject({ result: 'found', notified: false })
    pages['https://site2.example/'] = { status: 200, text: '<p>gone</p>' }
    rows[0]!.checkedAt = null
    await h.run()
    expect(h.notices).toEqual([['h2', 'missing']])
  })

  it('retries the notice next pass when sending failed', async () => {
    const rows = [row(2)]
    const h = harness(rows, false)
    expect((await h.run()).notified).toBe(0)
    expect(rows[0]!.notified).toBe(false)
  })

  it('skips sites checked recently', async () => {
    const rows = [row(1, { checkedAt: new Date(T0.getTime() - 3_600_000) })]
    expect((await harness(rows).run()).checked).toBe(0)
  })

  it('a site that throws does not stop the pass', async () => {
    const rows = [row(1), row(2)]
    const deps = {
      store: memoryStore(rows),
      check: async (s: string) => { if (s.includes('site1')) throw new Error('boom'); return 'missing' as const },
      notify: async () => true,
    }
    const r = await checkAttributionDue(deps, { now: () => T0, sleep: async () => {} })
    expect(r.checked).toBe(2)
    expect(rows[1]!.result).toBe('missing')
  })
})

describe('notifyWith', () => {
  it('sends a plain notice to the account and treats a missing address as handled', async () => {
    const send = vi.fn(async () => 'no_address' as const)
    const ok = await notifyWith({ send }, 'https://blueyvatar.com')({ hash: 'h', did: 'did:plc:a', site: 'https://s.example/', notified: false }, 'missing')
    expect(ok).toBe(true)
    expect(send).toHaveBeenCalledWith('did:plc:a', 'billing', expect.objectContaining({ subject: expect.stringContaining('attribution') }))
  })
  it('asks for a retry when the send failed', async () => {
    const ok = await notifyWith({ send: async () => 'failed' }, 'https://blueyvatar.com')({ hash: 'h', did: 'd', site: 'https://s.example/', notified: false }, 'nofollow')
    expect(ok).toBe(false)
  })
})

const url = process.env.TEST_DATABASE_URL
const schema = `t_attr_${process.pid}_${Date.now()}`
const sql = (f: string) => readFileSync(new URL(`../../../db/migrations/${f}`, import.meta.url), 'utf8')

describe.skipIf(!url)('pgAttributionStore', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    for (const f of ['0001_init.sql', '0024_attribution.sql']) await pool.query(sql(f))
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })

  it('selects only declared sites on active Free licenses and tracks the notified flag', async () => {
    await pool.query(`INSERT INTO licenses (license_id, owner, tier, status, attribution_required) VALUES
      ('l1','did:plc:a','free','active',true), ('l2','did:plc:b','pro','active',false), ('l3','did:plc:c','free','suspended',true)`)
    const k = (h: string, lic: string, site: string | null, revoked = false) =>
      pool.query(`INSERT INTO api_keys (key_hash, prefix, license_id, kind, attribution_site, revoked_at) VALUES ($1,'pk_x',$2,'publishable',$3,$4)`, [h.padEnd(64, '0'), lic, site, revoked ? new Date() : null])
    await k('a1', 'l1', 'https://a.example/')
    await k('a2', 'l1', null)
    await k('a3', 'l1', 'https://old.example/', true)
    await k('b1', 'l2', 'https://b.example/')
    await k('c1', 'l3', 'https://c.example/')
    const s = pgAttributionStore(pool)
    const gap = new Date(T0.getTime() - 20 * 3_600_000)
    const due = await s.due(gap, 50)
    expect(due).toEqual([{ hash: 'a1'.padEnd(64, '0'), did: 'did:plc:a', site: 'https://a.example/', notified: false }])
    await s.record('a1'.padEnd(64, '0'), 'missing', T0)
    await s.markNotified('a1'.padEnd(64, '0'), T0)
    expect(await s.due(gap, 50)).toEqual([])
    const later = new Date(T0.getTime() + 25 * 3_600_000)
    expect((await s.due(new Date(later.getTime() - 20 * 3_600_000), 50))[0]!.notified).toBe(true)
    await s.record('a1'.padEnd(64, '0'), 'unreachable', later)
    expect((await pool.query(`SELECT attribution_notified_at FROM api_keys WHERE key_hash = $1`, ['a1'.padEnd(64, '0')])).rows[0].attribution_notified_at).not.toBeNull()
    await s.record('a1'.padEnd(64, '0'), 'found', later)
    expect((await pool.query(`SELECT attribution_notified_at, attribution_result FROM api_keys WHERE key_hash = $1`, ['a1'.padEnd(64, '0')])).rows[0]).toEqual({ attribution_notified_at: null, attribution_result: 'found' })
  })
})
