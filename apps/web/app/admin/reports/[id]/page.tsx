import { notFound } from 'next/navigation'
import { PageMain } from '../../../../components/Page'
import { REASON_LABELS, type Reason } from '../../../../lib/reports'
import { requireAdmin } from '../../../../lib/admin/guard'
import { getReport, listActions } from '../../../../lib/admin/moderation'
import { dismissAction, takedownAction } from '../../actions'
import { AdminNav, fmt, Msg, ReasonForm } from '../../AdminBits'

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { pool } = await requireAdmin()
  const id = Number((await params).id)
  const report = Number.isSafeInteger(id) ? await getReport(pool, id) : null
  if (!report) return notFound()
  const prior = await listActions(pool, { did: report.target_did, limit: 20 })
  const { msg } = await searchParams
  return (
    <PageMain>
      <AdminNav />
      <h1>Report #{report.id}</h1>
      <Msg text={msg} />
      <section>
        <p><strong>{REASON_LABELS[report.reason as Reason] ?? report.reason}</strong> on the {report.source}, filed {fmt(report.created_at)}. Status: {report.status}.</p>
        <p>{report.details ?? 'No details given.'}</p>
        <p>Account <a href={`/admin/account?did=${encodeURIComponent(report.target_did)}`}><code>{report.target_did}</code></a>, {report.target_report_count} report(s) in total.</p>
        {report.has_contact && <p>The reporter left a contact. It is not shown here.</p>}
        {report.status !== 'open' && <p>Decided by {report.actioned_by} on {fmt(report.actioned_at)}: {report.action_reason}</p>}
      </section>
      {report.status === 'open' && (
        <>
          <ReasonForm action={dismissAction} label="Dismiss report" fields={{ report: report.id }} />
          <ReasonForm action={takedownAction} label="Take down all images" fields={{ report: report.id, did: report.target_did }} />
        </>
      )}
      <h2>Prior actions on this account</h2>
      {prior.length === 0 ? <p>None.</p> : (
        <ul>{prior.map((a) => <li key={a.id}>{fmt(a.created_at)} {a.action} by {a.actor}: {a.reason}</li>)}</ul>
      )}
    </PageMain>
  )
}
