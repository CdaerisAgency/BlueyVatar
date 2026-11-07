import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_MAX_GB, enforceLogRetention, logBytes, retentionConfig } from './log-retention.js'

describe('retentionConfig', () => {
  it('defaults to 90 days and the default cap', () => {
    expect(retentionConfig({})).toEqual({ days: 90, maxBytes: DEFAULT_MAX_GB * 1024 ** 3 })
  })
  it('reads the cap in GB, clamps days to 90, and ignores bad values', () => {
    expect(retentionConfig({ LOG_RETENTION_MAX_GB: '0.5', LOG_RETENTION_DAYS: '30' })).toEqual({ days: 30, maxBytes: 0.5 * 1024 ** 3 })
    expect(retentionConfig({ LOG_RETENTION_DAYS: '365' }).days).toBe(90)
    expect(retentionConfig({ LOG_RETENTION_MAX_GB: 'abc', LOG_RETENTION_DAYS: '-1' })).toEqual({ days: 90, maxBytes: DEFAULT_MAX_GB * 1024 ** 3 })
  })
})

// Runs against a real Postgres when TEST_DATABASE_URL is set; each run uses a throwaway schema.
const url = process.env.TEST_DATABASE_URL
const read = (f: string) => readFileSync(new URL(`../../../db/migrations/${f}`, import.meta.url), 'utf8')
const schema = `t_logret_${process.pid}_${Date.now()}`

describe.skipIf(!url)('log retention purge', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    for (const f of ['0001_init.sql', '0015_billing.sql', '0012_reports.sql', '0020_log_retention.sql', '0024_profile_view_counters.sql']) await pool.query(read(f))
  }, 60_000)
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  }, 60_000)

  const report = (ip: string, ageDays: number) => pool.query(
    "INSERT INTO reports (target_did, source, reason, ip_hash, created_at) VALUES ('did:plc:x', 'profile', 'spam', $1, now() - ($2 * interval '1 day'))", [ip, ageDays])
  const event = (id: string, ageDays: number) => pool.query(
    "INSERT INTO stripe_events (event_id, type, processed_at) VALUES ($1, 't', now() - ($2 * interval '1 day'))", [id, ageDays])

  it('clears IP hashes and event ids past the age limit, keeping the report rows', async () => {
    await report('old', 91); await report('new', 1); await event('evt_old', 91); await event('evt_new', 1)
    const res = await enforceLogRetention(pool, { days: 90, maxBytes: 1024 ** 3 })
    expect(res).toMatchObject({ expiredEvents: 1, expiredIpHashes: 1, trimmedEvents: 0, trimmedIpHashes: 0 })
    expect((await pool.query('SELECT ip_hash FROM reports ORDER BY created_at')).rows).toEqual([{ ip_hash: null }, { ip_hash: 'new' }])
    expect((await pool.query('SELECT event_id FROM stripe_events')).rows).toEqual([{ event_id: 'evt_new' }])
  })

  it('trims the oldest rows first when the size cap is exceeded, even inside the age window', async () => {
    await pool.query('DELETE FROM stripe_events; DELETE FROM reports')
    await event('e1', 30); await event('e2', 20); await report('r-mid', 25); await report('r-new', 2)
    const total = await logBytes(pool)
    const res = await enforceLogRetention(pool, { days: 90, maxBytes: Math.floor(total / 2) })
    expect(res.trimmedEvents + res.trimmedIpHashes).toBeGreaterThan(0)
    expect(await logBytes(pool)).toBeLessThanOrEqual(Math.floor(total / 2))
    const left = (await pool.query("SELECT event_id FROM stripe_events")).rows.map((r) => r.event_id)
    expect(left).not.toContain('e1')
  })

  it('stops when nothing is left to trim', async () => {
    await pool.query('DELETE FROM stripe_events; DELETE FROM reports')
    await event('e3', 1)
    await enforceLogRetention(pool, { days: 90, maxBytes: 0 })
    expect((await pool.query('SELECT 1 FROM stripe_events')).rowCount).toBe(0)
  })

  it('purges profile view counters older than the window and trims the oldest days under the size cap', async () => {
    await pool.query('DELETE FROM stripe_events; DELETE FROM reports; DELETE FROM profile_view_counters')
    const day = (ageDays: number, did: string) => pool.query(
      "INSERT INTO profile_view_counters (did, day, views) VALUES ($1, (now() AT TIME ZONE 'UTC')::date - $2::int, 1)", [did, ageDays])
    await day(91, 'did:plc:v'); await day(89, 'did:plc:v'); await day(1, 'did:plc:v')
    const res = await enforceLogRetention(pool, { days: 90, maxBytes: 1024 ** 3 })
    expect(res.expiredViewDays).toBe(1)
    expect((await pool.query('SELECT count(*)::int AS c FROM profile_view_counters')).rows[0].c).toBe(2)
    const total = await logBytes(pool)
    const trimmed = await enforceLogRetention(pool, { days: 90, maxBytes: Math.floor(total / 2) })
    expect(trimmed.trimmedViewDays).toBeGreaterThan(0)
    expect(await logBytes(pool)).toBeLessThanOrEqual(Math.floor(total / 2))
  })
})
