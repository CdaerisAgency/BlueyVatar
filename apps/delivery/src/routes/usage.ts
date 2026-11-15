import type { Hono } from 'hono'
import { historyDays, historyPeriods, includedVolume, periodEndOf, periodStartOf } from '@blueyvatar/core'
import type { Ctx } from '../context.js'
import { fail } from '../http.js'

export function mountUsage(app: Hono, ctx: Ctx): void {
  const { deps, entitle } = ctx

  // Usage API (spec sections 10.3 and 11.1). Secret keys only. The call hits the rate limit like any
  // keyed request but writes no meter and sends no x-usage-cost.
  app.get('/usage', async (c) => {
    const e = await entitle(c, false)
    if (!e.ok) return fail(c, e.status, e.code, e.message)
    c.header('cache-control', 'private, no-store')
    if (!e.licenseId || c.req.header('x-api-key') === undefined) {
      return fail(c, 401, 'invalid_key', 'Send a server key in the x-api-key header')
    }
    if (e.keyKind !== 'secret') {
      return fail(c, 403, 'secret_key_required', 'Usage is available to server keys only')
    }
    const now = new Date()
    const period = periodStartOf(now)
    const months = historyPeriods(e.tier, now)
    const days = historyDays(e.tier, now)
    const snap = await deps.usage.read(e.licenseId, [period, ...months], days)
    const m = (p: string, meter: string) => snap.monthly.get(`${p}|${meter}`) ?? 0
    const meters = (p: string) => ({ origin_resolution: m(p, 'origin_resolution'), profile_json: m(p, 'profile_json'), transform: m(p, 'transform') })
    const inc = includedVolume(e.tier)
    return c.json({
      tier: e.tier,
      period: { start: period, end: periodEndOf(period) },
      included: { volume: inc.volume, per: inc.per },
      total: m(period, 'origin_resolution'),
      meters: meters(period),
      history: {
        months: months.map((p) => ({ period: p, ...meters(p) })),
        days: days.map((d) => ({
          date: d,
          origin_resolution: snap.daily.get(`${d}|origin_resolution`) ?? 0,
          profile_json: snap.daily.get(`${d}|profile_json`) ?? 0,
        })),
      },
    })
  })
}
