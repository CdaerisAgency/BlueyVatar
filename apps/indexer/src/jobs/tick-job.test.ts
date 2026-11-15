import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { effectsSwitch } from '../effects-switch.js'
import { scheduleSwitch } from '../schedule-switch.js'

const NOW = new Date('2026-11-14T12:00:00Z')
const fakePool = (dids: string[]) => ({ query: vi.fn(async () => ({ rows: dids.map((did) => ({ did })) })) }) as unknown as pg.Pool
const queryMock = (pool: pg.Pool) => pool.query as unknown as ReturnType<typeof vi.fn>

describe.each([
  ['effects switch', effectsSwitch, '/account/effects/tick'],
  ['schedule switch', scheduleSwitch, '/account/avatars/schedule/tick'],
])('%s job (fake pool)', (_label, job, path) => {
  it('does nothing without a secret', async () => {
    const f = vi.fn()
    expect(await job.run(fakePool(['did:plc:a']), {}, f as unknown as typeof fetch, NOW)).toEqual({ due: 0, called: 0, failed: 0 })
    expect(f).not.toHaveBeenCalled()
    expect(job.job({} as pg.Pool, {})).toBeNull()
  })
  it('posts one authorized call per due account to its route, with a bounded batch', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    const pool = fakePool(['did:plc:a', 'did:plc:b'])
    const r = await job.run(pool, { EFFECTS_TICK_SECRET: 's3', PUBLIC_URL: 'https://x.test/' }, f as unknown as typeof fetch, NOW)
    expect(r).toEqual({ due: 2, called: 2, failed: 0 })
    const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }]
    expect(url).toBe(`https://x.test${path}`)
    expect(init.headers.authorization).toBe('Bearer s3')
    expect(JSON.parse(init.body)).toEqual({ did: 'did:plc:a' })
    expect(queryMock(pool).mock.calls[0]![1]).toEqual([NOW, job.batch])
  })
  it('counts refusals and network errors and keeps going', async () => {
    let n = 0
    const f = vi.fn(async () => {
      if (++n === 1) throw new Error('down')
      return new Response('no', { status: 500 })
    })
    expect(await job.run(fakePool(['did:plc:a', 'did:plc:b']), { EFFECTS_TICK_SECRET: 's' }, f as unknown as typeof fetch, NOW)).toEqual({ due: 2, called: 0, failed: 2 })
  })
  it('asks for a bounded batch even when nothing is due', async () => {
    const pool = fakePool([])
    await job.run(pool, { EFFECTS_TICK_SECRET: 's' }, vi.fn() as unknown as typeof fetch, NOW)
    expect(queryMock(pool).mock.calls[0]![1]).toEqual([NOW, 25])
  })
})

const url = process.env.TEST_DATABASE_URL
const schema = `t_effsw_${process.pid}_${Date.now()}`
describe.skipIf(!url)('effects switch query (database)', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    const dir = new URL('../../../../db/migrations/', import.meta.url)
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await pool.query(readFileSync(new URL(f, dir), 'utf8'))
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })
  it('selects started scheduled windows and ended active ones, and skips the rest', async () => {
    const past = new Date(NOW.getTime() - 3600_000), future = new Date(NOW.getTime() + 3600_000)
    const ins = (did: string, state: string, s: Date, e: Date, retry: Date | null = null) =>
      pool.query('INSERT INTO avatar_effects (did, away_state, away_start_at, away_end_at, away_retry_at) VALUES ($1,$2,$3,$4,$5)', [did, state, s, e, retry])
    await ins('did:plc:starts', 'scheduled', past, future)
    await ins('did:plc:later', 'scheduled', future, future)
    await ins('did:plc:ends', 'active', past, past)
    await ins('did:plc:running', 'active', past, future)
    await ins('did:plc:retry', 'active', past, past, future)
    const f = vi.fn(async () => new Response('{}'))
    const r = await effectsSwitch.run(pool, { EFFECTS_TICK_SECRET: 's' }, f as unknown as typeof fetch, NOW)
    expect(r.due).toBe(2)
    const dids = f.mock.calls.map((c) => JSON.parse((c as unknown as [string, { body: string }])[1].body).did).sort()
    expect(dids).toEqual(['did:plc:ends', 'did:plc:starts'])
  })
})
