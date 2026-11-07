import { PageMain } from '../../components/Page'
import { REASON_LABELS, type Reason } from '../../lib/reports'
import { requireAdmin } from '../../lib/admin/guard'
import { listReports } from '../../lib/admin/moderation'
import { AdminNav, fmt, Msg } from './AdminBits'

const STATUSES = ['open', 'actioned', 'dismissed', 'all'] as const

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ status?: string; msg?: string }> }) {
  const { pool } = await requireAdmin()
  const sp = await searchParams
  const status = STATUSES.find((s) => s === sp.status) ?? 'open'
  const reports = await listReports(pool, status)
  return (
    <PageMain>
      <AdminNav />
      <h1>Reports</h1>
      <Msg text={sp.msg} />
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
