import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { canViewChildSafety, formatSla, SEVERITY_LABELS, slaHours, slaState, syncCases } from '@blueyvatar/core/moderation'
import { SOR_TEMPLATES } from '@blueyvatar/core/verification'
import { PageMain } from '../../../../components/Page'
import { Button } from '../../../../components/Button'
import { REASON_LABELS, type Reason } from '../../../../lib/reports'
import { requireAdmin } from '../../../../lib/admin/guard'
import { ACTION_LABELS, allowedActions, caseDetail, claimCase, getWellness, type CaseAction, type CaseDetail } from '../../../../lib/admin/review'
import { caseAction, releaseCaseAction, skipCaseAction } from '../../actions'
import { GuardedImage } from '../../GuardedImage'
import { AdminNav, fmt, Msg, PolicySelect } from '../../AdminBits'

const label = (k: string) => REASON_LABELS[k as Reason] ?? k

function defaultFacts(d: CaseDetail): string {
  const reports = d.signals.filter((s) => s.kind === 'report')
  const auto = d.signals.filter((s) => s.kind === 'scanner' || s.kind === 'label')
  const parts: string[] = []
  if (reports.length) parts.push(`We received ${reports.length} report${reports.length === 1 ? '' : 's'} (${[...new Set(reports.map((r) => label(r.category)))].join(', ')}).`)
  if (auto.length) parts.push(`An automated check flagged the content (${[...new Set(auto.map((s) => `${s.kind}: ${s.source ?? s.category}`))].join(', ')}).`)
  return parts.join(' ')
}

function CaseForm({ id, action, title, children, notice }: { id: number; action: CaseAction; title: string; children?: ReactNode; notice?: { facts: string } }) {
  const t = notice ? SOR_TEMPLATES[action as keyof typeof SOR_TEMPLATES] : null
  return (
    <form action={caseAction} aria-label={title}>
      <h3>{title}</h3>
      <input type="hidden" name="case" value={id} />
      <input type="hidden" name="action" value={action} />
      {children}
      {notice && (
        <>
          <label>Facts for the account owner (what we saw, in plain words)
            <textarea name="facts" required rows={3} maxLength={800} defaultValue={notice.facts} />
          </label>
          {action !== 'reverse' && (
            <label>Why this breaks the policy, for the account owner
              <textarea name="explanation" required rows={2} maxLength={600} />
            </label>
          )}
          <details><summary>What the account owner receives</summary><pre className="whitespace-pre-wrap">{t?.body}</pre><p>The action is blocked if any field in this notice is empty.</p></details>
        </>
      )}
      <label>Reason (internal, recorded in the audit log) <input name="reason" required maxLength={500} autoComplete="off" /></label>
      <PolicySelect idSuffix={`${action}-${id}`} />
      <Button type="submit">{title}</Button>
    </form>
  )
}

export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { did, pool } = await requireAdmin()
  const id = Number((await params).id)
  const { msg } = await searchParams
  if (!Number.isSafeInteger(id)) return notFound()
  await syncCases(pool)
  const first = await caseDetail(pool, id)
  if (!first) return notFound()
  if (first.c.child_safety && !canViewChildSafety(did)) return notFound()
  const mine = await claimCase(pool, id, did)
  const d = mine ? await caseDetail(pool, id) : first
  if (!d) return notFound()
  const { c } = d
  const sla = slaHours()
  const s = slaState(c.opened_at, c.severity, sla, c.resolved_at ?? new Date())
  const well = mine && !c.child_safety ? await getWellness(pool, did) : null
  const allowed = mine ? allowedActions(c) : []
  const has = (a: CaseAction) => allowed.includes(a)
  const cids = c.subject_cid ? [c.subject_cid] : d.images.slice(0, 3).map((i) => i.cid)
  const facts = defaultFacts(d)
  const byKind = (k: string) => d.signals.filter((x) => x.kind === k)
  const reportCats = Object.entries(byKind('report').reduce<Record<string, number>>((m, x) => ({ ...m, [x.category]: (m[x.category] ?? 0) + 1 }), {}))
  return (
    <PageMain>
      <AdminNav did={did} />
      <h1>Case #{c.id}</h1>
      <Msg text={msg} />
      <section aria-label="Summary">
        <p>
          <strong>{SEVERITY_LABELS[c.severity]}</strong>, {c.status === 'appeal' ? 'appeal' : c.status}{c.child_safety ? ', child safety (restricted)' : ''}. Opened {fmt(c.opened_at)}.
          {c.status === 'resolved' ? <> Resolved {fmt(c.resolved_at)} by {c.resolved_by}.</> : <> {formatSla(s.msLeft)}{s.breached ? ' (SLA breached)' : ''}, due {fmt(s.dueAt)}.</>}
        </p>
        <p>Account <a href={`/admin/account?did=${encodeURIComponent(c.subject_did)}`}><code>{c.subject_did}</code></a>{c.subject_cid && <>, image <code>{c.subject_cid}</code></>}.
          {c.tags.length > 0 && <> Tags: {c.tags.join(', ')}.</>}</p>
        {mine
          ? <p>You hold this case. The lock lasts {fmt(c.locked_until)} and renews when you reopen the page.</p>
          : <p role="alert">{c.locked_by} is working on this case until {fmt(c.locked_until)}. You can read it but not act on it.</p>}
        {mine && c.status !== 'resolved' && (
          <div className="flex flex-wrap gap-3">
            <form action={skipCaseAction}><input type="hidden" name="case" value={c.id} /><Button type="submit">Skip to the next case</Button></form>
            <form action={releaseCaseAction}><input type="hidden" name="case" value={c.id} /><Button type="submit">Release and go home</Button></form>
          </div>
        )}
      </section>

      <section aria-label="Signals">
        <h2>Why this case exists</h2>
        <ul>
          {byKind('report').length > 0 && <li>{byKind('report').length} report{byKind('report').length === 1 ? '' : 's'}: {reportCats.map(([k, n]) => `${label(k)} (${n})`).join(', ')}. Reporter identity is hidden.</li>}
          {byKind('scanner').map((x) => <li key={x.id}>Scanner result at upload: {x.source ?? 'unknown service'}, {x.category}, {fmt(x.created_at)}</li>)}
          {byKind('label').map((x) => <li key={x.id}>Label: {x.source ?? x.category}, {fmt(x.created_at)}</li>)}
          {byKind('manual').length > 0 && <li>Opened by a reviewer.</li>}
          {d.appeal && <li>Appeal #{d.appeal.id} against {d.appeal.action} #{d.appeal.action_id} by {d.appeal.action_by}: {d.appeal.action_reason}</li>}
        </ul>
        {d.appeal && <p>Appellant statement: {d.appeal.statement}</p>}
        {d.reportNotes.filter((r) => r.details).map((r) => <p key={r.id}>Report #{r.id} ({label(r.reason)}, {r.source}): {r.details}</p>)}
      </section>

      {c.child_safety ? (
        <section aria-label="Restricted case">
          <h2>Restricted case</h2>
          <p>The image is not shown here and cannot be revealed. This portal holds only metadata for this case.</p>
          <p role="note">Reporting to NCMEC is on hold pending counsel, so there is no submit button. Divert the image from serving first. Preservation, reporting, and whether to tell the account owner follow counsel&apos;s written guidance. See the reviewer guide.</p>
        </section>
      ) : mine && well ? (
        <section aria-label="Images">
          <h2>Image{cids.length === 1 ? '' : 's'}</h2>
          <p>Hidden by default. Reveal only what you need to decide. Reveals are logged. Take a break if you need one.</p>
          {cids.length === 0 ? <p>No indexed images for this account.</p> : cids.map((cid) => (
            <GuardedImage key={cid} caseId={c.id} cid={cid} rating={d.images.find((i) => i.cid === cid)?.rating ?? 'unknown'} initialBlur={well.blurPx} initialGrayscale={well.grayscale} backTo={`/admin/cases/${c.id}`} />
          ))}
        </section>
      ) : null}

      <section aria-label="History">
        <h2>History</h2>
        <ul>
          <li>Prior actions on this account: {d.accountActions} (<a href="/admin/audit">audit log</a>). Other cases on this account: {d.otherCases.length === 0 ? 'none' : d.otherCases.map((o) => <span key={o.id}><a href={`/admin/cases/${o.id}`}>#{o.id}</a> {o.status} {o.severity}; </span>)}</li>
          {c.subject_cid && <li>Same image hash: used by {d.sameHash.accounts} account{d.sameHash.accounts === 1 ? '' : 's'}; {d.sameHash.blocks} block{d.sameHash.blocks === 1 ? '' : 's'}; {d.sameHash.actions} earlier action{d.sameHash.actions === 1 ? '' : 's'}; other cases: {d.sameHash.cases.length === 0 ? 'none' : d.sameHash.cases.map((o) => <span key={o.id}><a href={`/admin/cases/${o.id}`}>#{o.id}</a> ({o.status}); </span>)}</li>}
          {d.suspension && <li>Suspended {fmt(d.suspension.suspended_at)}: {d.suspension.reason}</li>}
          {d.blocked.map((b) => <li key={b.cid}>Blocked image <code>{b.cid}</code> ({b.kind}) since {fmt(b.blocked_at)}</li>)}
          {d.overrides.map((o) => <li key={o.cid}>Rating of <code>{o.cid}</code> changed from {o.prior_rating.toUpperCase()} to {o.rating.toUpperCase()}</li>)}
        </ul>
      </section>

      {mine && allowed.length > 0 && (
        <section aria-label="Actions">
          <h2>Actions</h2>
          <p>Every action needs a reason and a cited policy, and is written to the audit log.</p>
        </section>
      )}
      {has('acknowledge') && <CaseForm id={c.id} action="acknowledge" title={c.child_safety ? 'Close case after counsel guidance' : 'Acknowledge or dismiss'} />}
      {has('divert') && <CaseForm id={c.id} action="divert" title="Divert (remove from serving)" />}
      {has('remove_image') && (
        <CaseForm id={c.id} action="remove_image" title="Remove image" notice={{ facts }}>
          <fieldset><legend>Scope</legend>
            {c.subject_cid && <label><input type="radio" name="scope" value="image" defaultChecked /> This image only</label>}
            <label><input type="radio" name="scope" value="account" defaultChecked={!c.subject_cid} /> All images of the account</label>
          </fieldset>
        </CaseForm>
      )}
      {has('rating_change') && (
        <CaseForm id={c.id} action="rating_change" title="Apply rating change" notice={{ facts }}>
          <label>Image <select name="cid" defaultValue={c.subject_cid ?? ''}>{d.images.map((i) => <option key={i.cid} value={i.cid}>{i.cid.slice(0, 16)} (now {i.rating.toUpperCase()})</option>)}</select></label>
          <label>New rating <select name="rating" defaultValue="r"><option value="g">G</option><option value="pg">PG</option><option value="r">R</option><option value="x">X</option></select></label>
        </CaseForm>
      )}
      {has('warn') && <CaseForm id={c.id} action="warn" title="Warn" notice={{ facts }} />}
      {has('suspend') && <CaseForm id={c.id} action="suspend" title="Suspend account" notice={{ facts }} />}
      {has('escalate') && (
        <CaseForm id={c.id} action="escalate" title="Escalate">
          <label><input type="checkbox" name="childSafety" /> Send to the restricted child-safety queue. The image is taken out of serving at once and no one else sees it in this portal.</label>
        </CaseForm>
      )}
      {has('reverse') && (d.suspension || d.blocked.length > 0 || d.overrides.length > 0) && (
        <CaseForm id={c.id} action="reverse" title="Reverse an action" notice={{ facts: '' }}>
          <label>What to reverse
            <select name="what" required defaultValue="">
              <option value="" disabled>Choose</option>
              {d.suspension && <option value="suspension">Lift the suspension</option>}
              {d.blocked.map((b) => <option key={b.cid} value={`block:${b.cid}`}>Unblock image {b.cid.slice(0, 16)}</option>)}
              {d.overrides.map((o) => <option key={o.cid} value={`rating:${o.cid}`}>Restore rating of {o.cid.slice(0, 16)} to {o.prior_rating.toUpperCase()}</option>)}
            </select>
          </label>
        </CaseForm>
      )}
      {has('uphold') && <CaseForm id={c.id} action="uphold" title="Uphold decision" />}
      {has('overturn') && <CaseForm id={c.id} action="overturn" title="Overturn decision" />}
      {has('tag') && <CaseForm id={c.id} action="tag" title="Tag"><label>Tag <input name="tag" required maxLength={31} pattern="[a-z0-9][a-z0-9\-]*" /></label></CaseForm>}
      {has('comment') && <CaseForm id={c.id} action="comment" title="Comment" />}

      <section aria-label="Case log">
        <h2>Case log</h2>
        {d.events.length === 0 ? <p>No actions yet.</p> : (
          <ul>{d.events.map((e) => (
            <li key={e.id}>{fmt(e.created_at)} <strong>{e.action}</strong> by {e.actor}{e.policy && <>, policy {e.policy}</>}{e.reason && <>: {e.reason}</>}{e.notice_template && <> (notice {e.notice_template}: {e.notice_result})</>}</li>
          ))}</ul>
        )}
      </section>
    </PageMain>
  )
}
