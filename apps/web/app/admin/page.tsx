import { fmtHours, moderationMetrics, QUEUES, slaHours, syncCases, SEVERITIES, SEVERITY_LABELS, canViewChildSafety, WELLNESS_DEFAULTS } from '@blueyvatar/core/moderation'
import { requireAdmin } from '../../lib/admin/guard'
import { queueCounts } from '../../lib/admin/review-queue'
import { getWellness } from '../../lib/admin/wellness'
import { Button } from '../../components/Button'
import { saveWellnessAction } from './actions'
import { AdminPage } from './AdminBits'

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : 'none yet')

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { did, pool } = await requireAdmin()
  const sp = await searchParams
  await syncCases(pool)
  const sla = slaHours()
  const [counts, m, well] = await Promise.all([queueCounts(pool), moderationMetrics(pool, sla), getWellness(pool, did)])
  return (
    <AdminPage did={did} title="Moderation" msg={sp.msg}>
      <section aria-label="Queues">
        <h2>Queues</h2>
        <ul>
          {QUEUES.filter((q) => q.name !== 'child_safety' || canViewChildSafety(did)).map((q) => (
            <li key={q.name}><a href={`/admin/queue/${q.name}`}>{q.label}</a>: {counts[q.name]}</li>
          ))}
        </ul>
        <form action="/admin/account" method="get">
          <label>Look up an account <input name="did" placeholder="did:plc:..." required /></label>
          <button type="submit">Open</button>
        </form>
      </section>
      <section aria-label="Metrics">
        <h2>Metrics, last {m.windowDays} days</h2>
        <ul>
          <li>Time to first action: median {fmtHours(m.firstAction.medianHours)} ({m.firstAction.count} cases)</li>
          <li>
            Time to resolve: median {fmtHours(m.resolve.medianHours)} ({m.resolve.count} cases). Resolved within SLA: {pct(m.resolve.withinSla, m.resolve.count)}
            <br />{SEVERITIES.map((s) => `${SEVERITY_LABELS[s]} ${sla[s]}h target: ${pct(m.resolve.bySeverity[s].withinSla, m.resolve.bySeverity[s].count)}`).join('; ')}
          </li>
          <li>Backlog: {m.backlog.open} open, oldest {fmtHours(m.backlog.oldestHours)}, median age {fmtHours(m.backlog.medianHours)}</li>
          <li>Overturn rate on appeal: {m.overturn.rate === null ? 'no decided appeals' : `${Math.round(m.overturn.rate * 100)}% (${m.overturn.overturned} of ${m.overturn.decided})`}</li>
        </ul>
      </section>
      <section aria-label="Wellness">
        <h2>Your wellness settings</h2>
        <p>Images start blurred and grayscale. Change how strong the blur is here or while reviewing. Default: {WELLNESS_DEFAULTS.blurPx} px blur, grayscale on.</p>
        <form action={saveWellnessAction}>
          <input type="hidden" name="back" value="/admin" />
          <label>Blur strength (0 to 40 px) <input type="number" name="blur" min={0} max={40} defaultValue={well.blurPx} /></label>
          <label className="min-h-11 items-center"><input type="checkbox" name="grayscale" defaultChecked={well.grayscale} /> Grayscale</label>
          <Button type="submit">Save</Button>
        </form>
      </section>
    </AdminPage>
  )
}
