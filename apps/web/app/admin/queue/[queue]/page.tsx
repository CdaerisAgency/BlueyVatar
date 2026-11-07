import { notFound } from 'next/navigation'
import { canViewChildSafety, formatSla, QUEUES, SEVERITY_LABELS, slaHours, slaState, syncCases } from '@blueyvatar/core/moderation'
import { PageMain } from '../../../../components/Page'
import { Button } from '../../../../components/Button'
import { REASON_LABELS, type Reason } from '../../../../lib/reports'
import { requireAdmin } from '../../../../lib/admin/guard'
import { isQueue, listCases } from '../../../../lib/admin/review'
import { nextCaseAction } from '../../actions'
import { AdminNav, fmt, Msg } from '../../AdminBits'

export default async function QueuePage({ params, searchParams }: { params: Promise<{ queue: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { did, pool } = await requireAdmin()
  const { queue } = await params
  if (!isQueue(queue)) return notFound()
  const restricted = queue === 'child_safety'
  if (restricted && !canViewChildSafety(did)) return notFound()
  const { msg } = await searchParams
  await syncCases(pool)
  const cases = await listCases(pool, queue)
  const sla = slaHours()
  const now = new Date()
  const label = QUEUES.find((q) => q.name === queue)!.label
  return (
    <PageMain>
      <AdminNav did={did} />
      <h1>{label}</h1>
      <Msg text={msg} />
      {restricted && <p role="note">Restricted queue. Images are never shown here. Cases show metadata only.</p>}
      {queue !== 'resolved' && (
        <form action={nextCaseAction}>
          <input type="hidden" name="queue" value={queue} />
          <Button type="submit" variant="primary">Take the next case</Button>
        </form>
      )}
      <p>Most severe first, then oldest. {cases.length} case{cases.length === 1 ? '' : 's'}.</p>
      {cases.length === 0 ? <p>Nothing here.</p> : (
        <ul>
          {cases.map((c) => {
            const s = slaState(c.opened_at, c.severity, sla, c.resolved_at ?? now)
            const mine = c.locked_by === did
            const locked = c.locked_by && c.locked_until && c.locked_until > now
            return (
              <li key={c.id}>
                <a href={`/admin/cases/${c.id}`}>Case #{c.id}</a> <strong>{SEVERITY_LABELS[c.severity]}</strong>, opened {fmt(c.opened_at)}
                {c.status === 'resolved' ? <>, resolved {fmt(c.resolved_at)}</> : <>, {formatSla(s.msLeft)}{s.breached ? ' (SLA breached)' : ''}</>}
                <br />{c.report_count} report{c.report_count === 1 ? '' : 's'}; signals: {c.categories.map((k) => REASON_LABELS[k as Reason] ?? k).join(', ') || 'none'}
                {c.tags.length > 0 && <>; tags: {c.tags.join(', ')}</>}
                {locked && <><br />{mine ? 'You hold this case.' : `Locked by ${c.locked_by} until ${fmt(c.locked_until)}.`}</>}
                {!restricted && <><br /><code>{c.subject_cid ?? c.subject_did}</code></>}
              </li>
            )
          })}
        </ul>
      )}
    </PageMain>
  )
}
