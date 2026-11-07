import { PageMain } from '../../../components/Page'
import { requireAdmin } from '../../../lib/admin/guard'
import { listActions } from '../../../lib/admin/moderation'
import { AdminNav, fmt } from '../AdminBits'

export default async function AuditPage() {
  const { did, pool } = await requireAdmin()
  const rows = await listActions(pool, { limit: 200 })
  return (
    <PageMain>
      <AdminNav did={did} />
      <h1>Audit log</h1>
      {rows.length === 0 ? <p>No actions yet.</p> : (
        <ul>
          {rows.map((a) => (
            <li key={a.id}>
              {fmt(a.created_at)} <strong>{a.action}</strong> by {a.actor}
              {a.target_did && <> on <a href={`/admin/account?did=${encodeURIComponent(a.target_did)}`}><code>{a.target_did}</code></a></>}
              {a.target_cid && <> <code>{a.target_cid}</code></>}{a.report_id && <> (report #{a.report_id})</>}{a.case_id && <> (<a href={`/admin/cases/${a.case_id}`}>case #{a.case_id}</a>)</>}{a.policy && <>, policy {a.policy}</>}{a.notice_template && <>, notice {a.notice_template}: {a.notice_result}</>}: {a.reason}
            </li>
          ))}
        </ul>
      )}
    </PageMain>
  )
}
