import { notFound } from 'next/navigation'
import { PageMain } from '../../../components/Page'
import { requireAdmin } from '../../../lib/admin/guard'
import { accountSummary, DID_RE } from '../../../lib/admin/moderation'
import { Button } from '../../../components/Button'
import { openCaseAction } from '../actions'
import { AdminNav, fmt, Msg } from '../AdminBits'

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ did?: string; msg?: string }> }) {
  const { did: me, pool } = await requireAdmin()
  const { did, msg } = await searchParams
  if (!did || !DID_RE.test(did)) return notFound()
  const s = await accountSummary(pool, did)
  return (
    <PageMain>
      <AdminNav did={me} />
      <h1>Account</h1>
      <Msg text={msg} />
      <section>
        <p><code>{s.did}</code> {s.repo?.handle ? `(@${s.repo.handle})` : ''}</p>
        <p>Repo: {s.repo ? `${s.repo.active ? 'active' : 'inactive'}${s.repo.status ? `, ${s.repo.status}` : ''}` : 'not indexed'}.</p>
        <p>Reports: {s.reports.open} open, {s.reports.total} total. License: {s.license ? `${s.license.tier} (${s.license.status})` : 'none'}. Email holds: {s.emailHolds}.</p>
        <p>Subscriptions: {s.subscriptions.length ? s.subscriptions.map((x) => `${x.tier} ${x.status}${x.cancel_at_period_end ? ' (ends at period end)' : ''}`).join(', ') : 'none'}.</p>
        {s.suspension && <p role="alert">Suspended by {s.suspension.suspended_by} on {fmt(s.suspension.suspended_at)}: {s.suspension.reason}</p>}
      </section>
      <h2>Images ({s.images.length})</h2>
      <ul>{s.images.map((i) => <li key={i.rkey}><code>{i.cid}</code> rating {i.rating}{i.is_default ? ', default' : ''}</li>)}</ul>
      <h2>Blocked images ({s.blocked.length})</h2>
      <ul>{s.blocked.map((b) => <li key={b.cid}><code>{b.cid}</code>, {b.kind}, by {b.blocked_by}, {fmt(b.blocked_at)}: {b.reason}</li>)}</ul>
      <h2>Actions</h2>
      <p>Decisions are made in a case, so each one has a reason, a cited policy, and the right notice. Open the case for this account to act, reverse a block, or lift a suspension.</p>
      <form action={openCaseAction}>
        <input type="hidden" name="did" value={s.did} />
        <Button type="submit">Open a case for this account</Button>
      </form>
      <h2>History</h2>
      {s.actions.length === 0 ? <p>No actions recorded.</p> : (
        <ul>{s.actions.map((a) => <li key={a.id}>{fmt(a.created_at)} {a.action} by {a.actor}: {a.reason}</li>)}</ul>
      )}
    </PageMain>
  )
}
