import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashIp, parseReport, RATE_LIMIT, RATE_LIMIT_DID, RATE_WINDOW_MS, submitReport } from './reports'

describe('parseReport', () => {
  const ok = { did: 'did:plc:abc', reporterDid: 'did:plc:me', source: 'avatar', reason: 'spam', details: ' this is spam ', contact: ' a@b.test ' }
  const fail = (patch: object) => parseReport({ ...ok, ...patch })
  it('accepts a valid report and trims', () => {
    expect(parseReport(ok)).toEqual({ ok: true, value: { did: 'did:plc:abc', reporterDid: 'did:plc:me', source: 'avatar', reason: 'spam', details: 'this is spam', contact: 'a@b.test' } })
  })
  it('rejects a bad target, a missing reporter, and a bad reason', () => {
    expect(fail({ did: 'nope' })).toMatchObject({ ok: false, field: 'did' })
    expect(fail({ reporterDid: '' })).toMatchObject({ ok: false, field: 'did' })
    expect(fail({ reason: 'x' })).toMatchObject({ ok: false, field: 'reason', error: 'Choose a reason.' })
  })
  it('requires details, with a minimum length and a maximum', () => {
    expect(fail({ details: '' })).toMatchObject({ ok: false, field: 'details' })
    expect(fail({ details: '   ' })).toMatchObject({ ok: false, field: 'details' })
    expect(fail({ details: 'a' })).toMatchObject({ ok: false, field: 'details' })
    expect(fail({ details: '123456789' }).ok).toBe(false)
    expect(fail({ details: '1234567890' }).ok).toBe(true)
    expect(fail({ details: 'a'.repeat(2001) })).toMatchObject({ ok: false, field: 'details' })
  })
  it('requires a valid email', () => {
    expect(fail({ contact: '' })).toMatchObject({ ok: false, field: 'contact' })
    expect(fail({ contact: '  ' })).toMatchObject({ ok: false, field: 'contact' })
    expect(fail({ contact: 'not an email' })).toMatchObject({ ok: false, field: 'contact' })
    expect(fail({ contact: 'a@b' }).ok).toBe(false)
    expect(fail({ contact: `${'a'.repeat(250)}@b.test` })).toMatchObject({ ok: false, field: 'contact' })
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
  const input = { did: 'did:plc:abc', reporterDid: 'did:plc:me', source: 'profile' as const, reason: 'spam' as const, details: 'this is spam', contact: 'a@b.test' }
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    for (const f of ['0012_reports.sql', '0032_report_reporter_did.sql']) await pool.query(readFileSync(new URL(`../../../db/migrations/${f}`, import.meta.url), 'utf8'))
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })
  it('stores reports, then limits one IP, and frees it after the window', async () => {
    const now = new Date()
    const who = (n: number) => ({ ...input, reporterDid: `did:plc:r${n}` })
    for (let i = 0; i < RATE_LIMIT; i++) expect((await submitReport(pool, who(i), 'ip1', now)).ok).toBe(true)
    expect(await submitReport(pool, who(9), 'ip1', now)).toEqual({ ok: false, error: 'rate_limited' })
    expect((await submitReport(pool, who(10), 'ip2', now)).ok).toBe(true)
    expect((await submitReport(pool, who(11), 'ip1', new Date(now.getTime() + RATE_WINDOW_MS + 1000))).ok).toBe(true)
    const { rows } = await pool.query('SELECT reporter_contact, status, reporter_did FROM reports WHERE ip_hash = $1 LIMIT 1', ['ip2'])
    expect(rows[0]).toEqual({ reporter_contact: 'a@b.test', status: 'open', reporter_did: 'did:plc:r10' })
  })
  it('limits one account across different IPs', async () => {
    const now = new Date()
    for (let i = 0; i < RATE_LIMIT_DID; i++) expect((await submitReport(pool, input, `ipx${i}`, now)).ok).toBe(true)
    expect(await submitReport(pool, input, 'ipy', now)).toEqual({ ok: false, error: 'rate_limited' })
    expect((await submitReport(pool, { ...input, reporterDid: 'did:plc:other' }, 'ipy', now)).ok).toBe(true)
  })
})
