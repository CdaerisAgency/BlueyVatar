import { PageMain } from '../../components/Page'
import { REASON_LABELS, type Reason } from '../../lib/reports'
import { requireAdmin } from '../../lib/admin/guard'
import { listReports } from '../../lib/admin/moderation'
import { listAppeals } from '../../lib/admin/appeals'
import { Button } from '../../components/Button'
import { decideAppealAction } from './actions'
import { AdminNav, fmt, Msg } from './AdminBits'

const STATUSES = ['open', 'actioned', 'dismissed', 'all'] as const

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ status?: string; msg?: string }> }) {
  const { pool } = await requireAdmin()
  const sp = await searchParams
  const status = STATUSES.find((s) => s === sp.status) ?? 'open'
  const [reports, appeals] = await Promise.all([listReports(pool, status), listAppeals(pool, 'open')])
  return (
    <PageMain>
      <AdminNav />
      <h1>Moderation</h1>
      <Msg text={sp.msg} />
      <h2 id="appeals">Appeals ({appeals.length} open)</h2>
      {appeals.length === 0 ? <p>No open appeals.</p> : (
        <ul>
          {appeals.map((a) => (
            <li key={a.id}>
              Appeal #{a.id} by <a href={`/admin/account?did=${encodeURIComponent(a.did)}`}><code>{a.did}</code></a>, {fmt(a.created_at)}
              <br />Against {a.action} #{a.action_id} by {a.action_by}, {fmt(a.action_at)}: {a.action_reason}
              <br />Statement: {a.statement}
              <form action={decideAppealAction}>
                <input type="hidden" name="appeal" value={a.id} />
                <label>Reason (recorded in the audit log){' '}<input name="reason" required maxLength={480} autoComplete="off" /></label>
                <Button type="submit" name="decision" value="uphold">Uphold decision</Button>
                <Button type="submit" name="decision" value="overturn">Overturn decision</Button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <h2>Reports</h2>
      <p>{STATUSES.map((s) => (s === status ? <strong key={s}>{s} </strong> : <a key={s} href={`/admin?status=${s}`}>{s} </a>))}</p>
      <form action="/admin/account" method="get">
        <label>Look up an account <input name="did" placeholder="did:plc:..." required /></label>
        <button type="submit">Open</button>
      </form>
      {reports.length === 0 ? <p>No {status === 'all' ? '' : status} reports.</p> : (
        <ul>
          {reports.map((r) => (
            <li key={r.id}>
              <a href={`/admin/reports/${r.id}`}>#{r.id}</a> {REASON_LABELS[r.reason as Reason] ?? r.reason} on {r.source}, {fmt(r.created_at)}, {r.status}
              <br /><code>{r.target_did}</code> ({r.target_report_count} report{r.target_report_count === 1 ? '' : 's'} on this account)
            </li>
          ))}
        </ul>
      )}
    </PageMain>
  )
}
