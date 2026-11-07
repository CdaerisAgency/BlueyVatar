import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pgStore, SESSION_TOUCH_MS } from './store'

const url = process.env.TEST_DATABASE_URL
const schema = `t_sess_${process.pid}_${Date.now()}`
const DID = 'did:web:alice.example.com'

describe.skipIf(!url)('postgres web sessions (migration 0023)', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    await pool.query(readFileSync(new URL('../../../db/migrations/0023_web_sessions.sql', import.meta.url), 'utf8'))
  })
  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool.end()
  })

  it('creates, lists, validates, and revokes', async () => {
    const s = pgStore(pool).sessions
    const a = await s.create(DID, 'Firefox on Linux')
    const b = await s.create(DID, 'Safari on iOS')
    expect((await s.list(DID)).map((x) => x.device).sort()).toEqual(['Firefox on Linux', 'Safari on iOS'])
    expect(await s.valid(DID, a, Date.now())).toBe(true)
    expect(await s.valid('did:plc:other', a, Date.now())).toBe(false)
    expect(await s.revoke('did:plc:other', a)).toBe(false)
    expect(await s.revoke(DID, a)).toBe(true)
    expect(await s.valid(DID, a, Date.now())).toBe(false)
    expect(await s.valid(DID, b, Date.now())).toBe(true)
  })

  it('touches last use only after the interval', async () => {
    const s = pgStore(pool).sessions
    const id = await s.create(DID, 'x')
    const used = async () => (await pool.query('SELECT last_used_at FROM web_session WHERE id = $1', [id])).rows[0].last_used_at.getTime() as number
    const first = await used()
    await s.valid(DID, id, Date.now())
    expect(await used()).toBe(first)
    await pool.query(`UPDATE web_session SET last_used_at = last_used_at - ($2 * interval '1 millisecond') WHERE id = $1`, [id, SESSION_TOUCH_MS + 1000])
    const old = await used()
    await s.valid(DID, id, Date.now())
    expect(await used()).toBeGreaterThan(old)
  })

  it('sign out everywhere removes rows and rejects older cookies, not newer ones', async () => {
    const s = pgStore(pool).sessions
    const keep = await s.create('did:plc:other', 'x')
    await s.create(DID, 'y')
    const issued = Date.now() - 1000
    expect(await s.revokeAll(DID)).toBeGreaterThanOrEqual(1)
    expect(await s.list(DID)).toEqual([])
    expect(await s.valid(DID, null, issued)).toBe(false)
    expect(await s.valid('did:plc:other', keep, Date.now())).toBe(true)
    expect(await s.valid(DID, null, Date.now() + 5000)).toBe(true)
    const fresh = await s.create(DID, 'z')
    expect(await s.valid(DID, fresh, Date.now() + 5000)).toBe(true)
  })
})
