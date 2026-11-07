import { ENTITLEMENTS, type Tier } from './tiers.js'

/** First day of the UTC month as YYYY-MM-DD, matching usage_counters.period_start. */
export function periodStartOf(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
}

/** Monthly periods a tier's usage view covers: Pro 30 days (this and last month), Business 12 months. */
export function historyPeriods(tier: Tier, now: Date): string[] {
  const count = tier === 'free' ? 0 : tier === 'pro' ? 2 : 12
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(periodStartOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))))
  return out
}

/** Days of per-day history for a tier (spec section 11.1): Pro and Business see the last 30 days, Free sees none. */
export function historyDayCount(tier: Tier): number {
  return tier === 'free' ? 0 : 30
}

/** The last `historyDayCount(tier)` UTC dates ending today, newest first, as YYYY-MM-DD. */
export function historyDays(tier: Tier, now: Date): string[] {
  const count = historyDayCount(tier)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)).toISOString().slice(0, 10))
  }
  return out
}

/** Meters recorded per day in addition to the monthly counters. Billing reads only the monthly counters. */
export const DAILY_METERS = ['origin_resolution', 'profile_json'] as const
export type DailyMeter = (typeof DAILY_METERS)[number]

export interface Included {
  volume: number | null
  per: 'day' | 'month' | null
}

export function includedVolume(tier: Tier): Included {
  const e = ENTITLEMENTS[tier]
  if (e.keyedMonthly !== null) return { volume: e.keyedMonthly, per: 'month' }
  if (e.keyedDaily !== null) return { volume: e.keyedDaily, per: 'day' }
  return { volume: null, per: null }
}

/** Last day of the UTC month that starts at `periodStart` (YYYY-MM-01), as YYYY-MM-DD. */
export function periodEndOf(periodStart: string): string {
  const [y, m] = periodStart.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}
