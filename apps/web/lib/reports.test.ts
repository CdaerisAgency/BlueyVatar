import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashIp, parseReport, RATE_LIMIT, RATE_WINDOW_MS, submitReport } from './reports'

describe('parseReport', () => {
  const ok = { did: 'did:plc:abc', source: 'avatar', reason: 'spam', details: ' hi ', contact: '' }
  it('accepts a valid report and trims', () => {
    expect(parseReport(ok)).toEqual({ ok: true, value: { did: 'did:plc:abc', source: 'avatar', reason: 'spam', details: 'hi', contact: null } })
  })
  it('rejects bad did, reason, and empty other', () => {
    expect(parseReport({ ...ok, did: 'nope' }).ok).toBe(false)
    expect(parseReport({ ...ok, reason: 'x' }).ok).toBe(false)
    expect(parseReport({ ...ok, reason: 'other', details: '' }).ok).toBe(false)
    expect(parseReport({ ...ok, details: 'a'.repeat(2001) }).ok).toBe(false)
  })
  it('hashes the IP with the secret', () => {
    expect(hashIp('1.2.3.4', 's')).not.toBe(hashIp('1.2.3.4', 't'))
    expect(hashIp('1.2.3.4', 's')).not.toContain('1.2.3.4')
  })
})

const url = process.env.TEST_DATABASE_URL
const schema = `t_reports_${process.pid}_${Date.now()}`
describe.skipIf(!url)('submitReport', () => {
  let pool: pg.Pool
  const input = { did: 'did:plc:abc', source: 'profile' as const, reason: 'spam' as const, details: null, contact: 'a@b.test' }
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    await pool.query(readFileSync(new URL('../../../db/migrations/0012_reports.sql', import.meta.url), 'utf8'))
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })
  it('stores reports, then limits one IP, and frees it after the window', async () => {
    const now = new Date()
    for (let i = 0; i < RATE_LIMIT; i++) expect((await submitReport(pool, input, 'ip1', now)).ok).toBe(true)
    expect(await submitReport(pool, input, 'ip1', now)).toEqual({ ok: false, error: 'rate_limited' })
    expect((await submitReport(pool, input, 'ip2', now)).ok).toBe(true)
    expect((await submitReport(pool, input, 'ip1', new Date(now.getTime() + RATE_WINDOW_MS + 1000))).ok).toBe(true)
    const { rows } = await pool.query('SELECT reporter_contact, status FROM reports WHERE ip_hash = $1 LIMIT 1', ['ip2'])
    expect(rows[0]).toEqual({ reporter_contact: 'a@b.test', status: 'open' })
  })
})
