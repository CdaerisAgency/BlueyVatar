import { ENTITLEMENTS, historyDays, type Tier } from '@blueyvatar/core'
import { Section, TableBox } from '../../../components/Page'
import { getDashboardStore } from '../../../lib/dashboard-store'
import { alertState, historyPeriods, includedVolume, periodStartOf } from '../../../lib/keys'

const n = (v: number | null) => (v === null ? 'Custom' : v.toLocaleString('en-US'))
const ALERT_TEXT = { ok: 'Below 80 percent of included volume.', warn80: 'At or above 80 percent of included volume.', over100: 'Included volume reached.', 'n/a': 'No monthly alert for this tier.' }

/** The License section, plan limits, usage history, and alert status. Shared by the personal and organization billing views. */
export async function LicenseUsage({ license }: { license: { licenseId: string; tier: Tier; status: string; term: string } }) {
  const store = getDashboardStore()
  const now = new Date()
  const period = periodStartOf(now)
  const periods = historyPeriods(license.tier, now)
  const usage = await store.usage(license.licenseId, [period, ...periods])
  const days = historyDays(license.tier, now)
  const daily = await store.usageDaily(license.licenseId, days)
  const sent = await store.alertsSent(license.licenseId, period)
  const ent = ENTITLEMENTS[license.tier]
  const inc = includedVolume(license.tier)
  const used = usage.get(`${period}|origin_resolution`) ?? 0
  const state = alertState(license.tier, used)
  return (
    <>
      <Section title="License">
      <ul>
        <li>Tier: {license.tier}</li>
        <li>Status: {license.status.replace('_', ' ')}</li>
        <li>Term: {license.term}</li>
        <li>Included volume: {inc.volume === null ? 'Custom' : `${n(inc.volume)} keyed requests per ${inc.per}`}</li>
        <li>Keys allowed: {ent.maxKeys === null ? 'Unlimited' : n(ent.maxKeys)}</li>
        <li>
          Usage this period ({period}): {n(used)} origin resolutions
          {inc.per === 'month' && inc.volume ? ` of ${n(inc.volume)} (${Math.round((used / inc.volume) * 100)} percent)` : ''}
        </li>
        <li>
          Alerts: {ALERT_TEXT[state]} {sent.length > 0 ? `Sent this period: ${sent.map((t) => `${t} percent`).join(', ')}.` : 'None sent this period.'}
        </li>
        {inc.per === 'day' && <li>Free limits are per day, so the monthly total above is for reference.</li>}
      </ul>
      </Section>

      {periods.length > 0 && (
        <Section title="Usage history">
          <TableBox label="Usage history">
            <table>
              <thead>
                <tr>
                  <th align="left">Month</th>
                  <th align="right">Origin resolutions</th>
                  <th align="right">Profile JSON calls</th>
                  <th align="right">Transforms</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p}>
                    <td>{p.slice(0, 7)}</td>
                    <td align="right">{n(usage.get(`${p}|origin_resolution`) ?? 0)}</td>
                    <td align="right">{n(usage.get(`${p}|profile_json`) ?? 0)}</td>
                    <td align="right">{n(usage.get(`${p}|transform`) ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableBox>
          <p>{license.tier === 'plus' ? 'Plus shows 30 days of history.' : 'Shows up to 12 months of history.'}</p>
          <h3>Last 30 days</h3>
          <TableBox label="Daily usage">
            <table>
              <thead>
                <tr>
                  <th align="left">Day (UTC)</th>
                  <th align="right">Origin resolutions</th>
                  <th align="right">Profile JSON calls</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d}>
                    <td>{d}</td>
                    <td align="right">{n(daily.get(`${d}|origin_resolution`) ?? 0)}</td>
                    <td align="right">{n(daily.get(`${d}|profile_json`) ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableBox>
          <p>The same numbers are available from code with <code>GET /usage</code> and a secret key. See the API docs.</p>
        </Section>
      )}
    </>
  )
}
