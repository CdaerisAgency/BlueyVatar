import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { incrementView, isBotRequest, lastDaysStats, recordProfileView, statsForPlan, utcDay } from './profile-views'

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null })
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

describe('isBotRequest', () => {
  it('skips crawlers, tools, missing user agents, and prefetches', () => {
    for (const ua of ['Googlebot/2.1 (+http://www.google.com/bot.html)', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'curl/8.4.0', 'Slackbot-LinkExpanding 1.0', 'facebookexternalhit/1.1', 'python-requests/2.31', 'Mozilla/5.0 HeadlessChrome/120']) {
      expect(isBotRequest(h({ 'user-agent': ua }))).toBe(true)
    }
    expect(isBotRequest(h({}))).toBe(true)
    expect(isBotRequest(h({ 'user-agent': CHROME, 'next-router-prefetch': '1' }))).toBe(true)
    expect(isBotRequest(h({ 'user-agent': CHROME, purpose: 'prefetch' }))).toBe(true)
  })
  it('counts an ordinary browser', () => {
    expect(isBotRequest(h({ 'user-agent': CHROME }))).toBe(false)
  })
})

describe('recordProfileView without a database', () => {
  it('does nothing and reports false', async () => {
    expect(await recordProfileView(null, 'did:plc:a', h({ 'user-agent': CHROME }))).toBe(false)
  })
  it('never throws when the write fails', async () => {
    const broken = { query: async () => { throw new Error('down') } } as unknown as pg.Pool
    expect(await recordProfileView(broken, 'did:plc:a', h({ 'user-agent': CHROME }))).toBe(false)
  })
})

describe('statsForPlan', () => {
  it('returns null for Free so the page shows the upgrade prompt, and never queries', async () => {
    const spy = { query: async () => { throw new Error('should not query') } } as unknown as pg.Pool
    expect(await statsForPlan(spy, 'did:plc:a', 'free')).toBeNull()
    const s = await statsForPlan(null, 'did:plc:a', 'plus', new Date('2026-11-07T12:00:00Z'))
    expect(s?.days).toHaveLength(30)
    expect(s?.totalViews).toBe(0)
  })
})

const url = process.env.TEST_DATABASE_URL
const schema = `t_pviews_${process.pid}_${Date.now()}`

describe.skipIf(!url)('profile view counters', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    const dir = new URL('../../../db/migrations/', import.meta.url)
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await pool.query(readFileSync(new URL(f, dir), 'utf8'))
  }, 60_000)
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  }, 60_000)

  const now = new Date('2026-11-07T23:59:00Z')

  it('upserts one row per DID per UTC day, safely under concurrency', async () => {
    await Promise.all(Array.from({ length: 25 }, () => incrementView(pool, 'did:plc:a', now)))
    await incrementView(pool, 'did:plc:a', new Date('2026-11-08T00:00:01Z'))
    const rows = (await pool.query("SELECT to_char(day,'YYYY-MM-DD') AS day, views FROM profile_view_counters WHERE did = 'did:plc:a' ORDER BY day")).rows
    expect(rows.map((r) => [r.day, Number(r.views)])).toEqual([['2026-11-07', 25], ['2026-11-08', 1]])
  })

  it('counts a browser and skips a bot through recordProfileView', async () => {
    expect(await recordProfileView(pool, 'did:plc:b', h({ 'user-agent': CHROME }), now)).toBe(true)
    expect(await recordProfileView(pool, 'did:plc:b', h({ 'user-agent': 'Googlebot/2.1' }), now)).toBe(false)
    expect(Number((await pool.query("SELECT views FROM profile_view_counters WHERE did = 'did:plc:b'")).rows[0].views)).toBe(1)
  })

  it('stores nothing but the DID, the day, and two counters', async () => {
    const cols = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'profile_view_counters' ORDER BY column_name", [schema])).rows.map((r) => r.column_name)
    expect(cols).toEqual(['day', 'did', 'json_calls', 'views'])
  })

  it('reads the last 30 UTC days with zero days filled and totals', async () => {
    await pool.query("INSERT INTO profile_view_counters (did, day, views, json_calls) VALUES ('did:plc:c', '2026-10-09', 4, 1), ('did:plc:c', '2026-10-08', 99, 99), ('did:plc:c', '2026-11-07', 3, 2)")
    const s = await lastDaysStats(pool, 'did:plc:c', now)
    expect(s.days).toHaveLength(30)
    expect(s.days[0]).toEqual({ day: '2026-11-07', views: 3, jsonCalls: 2 })
    expect(s.days[29]).toEqual({ day: '2026-10-09', views: 4, jsonCalls: 1 })
    expect(s.days[1]).toEqual({ day: '2026-11-06', views: 0, jsonCalls: 0 })
    expect(s.totalViews).toBe(7)
    expect(s.totalJsonCalls).toBe(3)
    expect(utcDay(now)).toBe('2026-11-07')
  })
})
