import type pg from 'pg'
import { reportError } from './obs'
import type { Plan } from './records'

/**
 * Profile view statistics (issue #173). Only aggregate daily counters are kept, one row per DID per UTC day
 * (migration 0024). The user agent is read once to skip crawlers and is never stored; no IP or cookie is read.
 */

/** Days shown on /account/stats. */
export const STATS_DAYS = 30

type Q = Pick<pg.Pool, 'query'>

const BOT_UA = /bot|crawl|spider|slurp|scrape|fetch|monitor|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|pinterest|lighthouse|headless|phantom|python-requests|python-urllib|curl\/|wget|httpclient|okhttp|go-http-client|java\/|libwww|axios|node-fetch|undici|postman|uptime|pingdom|datadog|statuscake|cloudflare|archive\.org|ia_archiver/i

/** True for a request that should not count: no user agent, a known crawler or tool, or a framework prefetch. */
export function isBotRequest(h: { get(name: string): string | null }): boolean {
  const ua = h.get('user-agent')
  if (!ua || BOT_UA.test(ua)) return true
  if (h.get('next-router-prefetch') || /prefetch|prerender/i.test(h.get('purpose') ?? '') || /prefetch|prerender/i.test(h.get('sec-purpose') ?? '')) return true
  return false
}

/** The UTC day of `now` as YYYY-MM-DD. */
export const utcDay = (now: Date): string => now.toISOString().slice(0, 10)

/** Adds one view for the DID's UTC day. One atomic upsert, so concurrent requests never lose a count. */
export async function incrementView(pool: Q, did: string, now: Date = new Date()): Promise<void> {
  await pool.query(
    `INSERT INTO profile_view_counters (did, day, views) VALUES ($1, $2, 1)
     ON CONFLICT (did, day) DO UPDATE SET views = profile_view_counters.views + 1`,
    [did, utcDay(now)],
  )
}

/** Counts a view unless the request is a bot or there is no database. A failure is reported and never breaks the page. */
export async function recordProfileView(pool: Q | null, did: string, headers: { get(name: string): string | null }, now: Date = new Date()): Promise<boolean> {
  if (!pool || isBotRequest(headers)) return false
  try {
    await incrementView(pool, did, now)
    return true
  } catch (err) {
    reportError('profile view count failed', err)
    return false
  }
}

export type StatsDay = { day: string; views: number; jsonCalls: number }
export type Stats = { days: StatsDay[]; totalViews: number; totalJsonCalls: number }

/** The last `days` UTC days ending today, newest first, with zero rows filled in. */
export async function lastDaysStats(pool: Q | null, did: string, now: Date = new Date(), days: number = STATS_DAYS): Promise<Stats> {
  const found = new Map<string, { views: number; jsonCalls: number }>()
  if (pool) {
    const from = utcDay(new Date(now.getTime() - (days - 1) * 86_400_000))
    const res = await pool.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, views, json_calls FROM profile_view_counters WHERE did = $1 AND day >= $2::date AND day <= $3::date`,
      [did, from, utcDay(now)],
    )
    for (const r of res.rows as { day: string; views: string | number; json_calls: string | number }[]) found.set(r.day, { views: Number(r.views), jsonCalls: Number(r.json_calls) })
  }
  const out: StatsDay[] = []
  for (let i = 0; i < days; i++) {
    const day = utcDay(new Date(now.getTime() - i * 86_400_000))
    out.push({ day, views: found.get(day)?.views ?? 0, jsonCalls: found.get(day)?.jsonCalls ?? 0 })
  }
  return { days: out, totalViews: out.reduce((s, d) => s + d.views, 0), totalJsonCalls: out.reduce((s, d) => s + d.jsonCalls, 0) }
}

/** The Plus gate for /account/stats: statistics for Plus, null (show the upgrade prompt) for everyone else. */
export async function statsForPlan(pool: Q | null, did: string, plan: Plan, now: Date = new Date()): Promise<Stats | null> {
  return plan === 'plus' ? lastDaysStats(pool, did, now) : null
}
