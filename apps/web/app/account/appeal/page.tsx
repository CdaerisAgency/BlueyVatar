import { PageMain } from '../../../components/Page'
import { Button } from '../../../components/Button'
import { MAX_STATEMENT, appealableActions } from '../../../lib/appeals'
import { requireDid } from '../../../lib/auth'
import { getPool } from '../../../lib/store'
import { submitAppealAction } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Appeal a decision' }

const LABEL = { takedown: 'Images removed', block_image: 'Image removed', suspend: 'Account suspended', warn: 'Warning', rating_change: 'Image rating changed' } as const

export default async function AppealPage({ searchParams }: { searchParams: Promise<{ action?: string; sent?: string; error?: string }> }) {
  const sp = await searchParams
  const did = await requireDid(`/account/appeal${sp.action ? `?action=${encodeURIComponent(sp.action)}` : ''}`)
  const pool = getPool()
  const actions = pool ? await appealableActions(pool, did) : []
  const chosen = actions.find((a) => String(a.id) === sp.action)
  return (
    <PageMain>
      <h1>Appeal a decision</h1>
      <p>Signed in as {did}</p>
      <p>You can appeal a takedown, a suspension, a warning, or a rating change on your account. Each action can be appealed once. See the <a href="/policy#appeals">content policy</a>.</p>
      {sp.error && <p role="alert">{sp.error}</p>}
      {sp.sent && <p role="status">Your appeal was received (number {sp.sent}). We will email you the outcome at the primary email on your account.</p>}
      {!pool && <p role="status">Appeals need the database, which is not configured here.</p>}
      {pool && actions.length === 0 && <p>There is no moderation action on your account that can be appealed.</p>}
      {actions.length > 0 && !chosen && (
        <ul>
          {actions.map((a) => (
            <li key={a.id}>
              {LABEL[a.action]}, {a.created_at.toISOString().slice(0, 10)}:{' '}
              {a.appeal ? `appeal ${a.appeal.status}` : <a href={`/account/appeal?action=${a.id}`}>appeal this</a>}
            </li>
          ))}
        </ul>
      )}
      {chosen && (chosen.appeal ? <p>This action already has an appeal ({chosen.appeal.status}).</p> : (
        <form action={submitAppealAction}>
          <input type="hidden" name="action" value={chosen.id} />
          <p>{LABEL[chosen.action]} on {chosen.created_at.toISOString().slice(0, 10)}.</p>
          <p><label>Why should we reverse this decision?<br /><textarea name="statement" rows={6} maxLength={MAX_STATEMENT} required /></label></p>
          <Button type="submit">Send appeal</Button>
        </form>
      ))}
    </PageMain>
  )
}
