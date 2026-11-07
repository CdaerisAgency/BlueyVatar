import Link from 'next/link'
import { Note, PageMain, TableBox } from '../../../components/Page'
import { requireDid } from '../../../lib/auth'
import { resolvePlan } from '../../../lib/plan'
import { STATS_DAYS, statsForPlan } from '../../../lib/profile-views'
import { limited } from '../../../lib/rate-guard'
import { getPool } from '../../../lib/store'
import AccountNav from '../AccountNav'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Profile views' }

const n = (v: number) => v.toLocaleString('en-US')

export default async function StatsPage() {
  const did = await requireDid('/account/stats')
  const plus = (await resolvePlan(did)) === 'plus'
  const wait = plus ? await limited(['stats.did'], did) : null
  const stats = wait ? null : await statsForPlan(getPool(), did, plus ? 'plus' : 'free')

  return (
    <PageMain>
      <AccountNav />
      <h1>Profile views</h1>
      {!plus && (
        <Note>
          <p>
            <strong>Profile view statistics are part of the Plus plan.</strong> You are on the Free plan, so this page is locked.{' '}
            <Link href="/account/billing">Upgrade to Plus</Link> to see daily views for the last {STATS_DAYS} days.
          </p>
        </Note>
      )}
      {wait && <p role="alert">{wait}</p>}
      {stats && (
        <>
          <p>
            Daily views of your public profile page for the last {STATS_DAYS} days, by UTC day. Known crawlers are not counted. Only a
            daily total is kept, never an IP address, user agent, or cookie.
          </p>
          <p>
            Total: <strong>{n(stats.totalViews)}</strong> profile views and <strong>{n(stats.totalJsonCalls)}</strong> keyed profile API calls.
          </p>
          <TableBox label="Profile views by day">
            <table>
              <thead>
                <tr>
                  <th align="left">Day (UTC)</th>
                  <th align="right">Profile views</th>
                  <th align="right">Profile API calls</th>
                </tr>
              </thead>
              <tbody>
                {stats.days.map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    <td align="right">{n(d.views)}</td>
                    <td align="right">{n(d.jsonCalls)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th align="left">Total</th>
                  <td align="right">{n(stats.totalViews)}</td>
                  <td align="right">{n(stats.totalJsonCalls)}</td>
                </tr>
              </tfoot>
            </table>
          </TableBox>
        </>
      )}
    </PageMain>
  )
}
