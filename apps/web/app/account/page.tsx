import { redirect } from 'next/navigation'
import { addEmail, linkEmail, makePrimary, unlink } from '../actions'
import { currentDid } from '../../lib/auth'
import { MAX_LINKED_EMAILS, HOLD_DAYS } from '../../lib/email-policy'
import { getStore } from '../../lib/store'

export const dynamic = 'force-dynamic'

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string; linked?: string }> }) {
  const did = await currentDid()
  if (!did) redirect('/login')
  const { error, linked } = await searchParams
  const links = await getStore().links.list(did)
  return (
    <main>
      <h1>Account</h1>
      <p>Signed in as {did}</p>
      {error && <p role="alert">{error}</p>}
      {linked && <p>Linked {linked}. Only the hash is stored.</p>}
      <h2>Linked emails ({links.length} of {MAX_LINKED_EMAILS})</h2>
      {links.length === 0 ? (
        <p>No email linked yet.</p>
      ) : (
        <ul>
          {links.map((l) => (
            <li key={l.emailHash}>
              <code>{l.emailHash}</code> ({l.method}){l.primary && <strong> primary</strong>}{' '}
              {!l.primary && (
                <form action={makePrimary} style={{ display: 'inline' }}>
                  <input type="hidden" name="hash" value={l.emailHash} />
                  <button type="submit">Make primary</button>
                </form>
              )}{' '}
              <form action={unlink} style={{ display: 'inline' }}>
                <input type="hidden" name="hash" value={l.emailHash} />
                <button type="submit">Unlink</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <h2>Link email</h2>
      <p>
        You can link up to {MAX_LINKED_EMAILS} emails. An address you unlink is held for {HOLD_DAYS} days: only this account can
        link it again until then.
      </p>
      <form action={linkEmail}>
        <button type="submit">Link the email from my PDS</button>
      </form>
      <form action={addEmail}>
        <label>
          Add another email by code <input name="email" type="email" required autoComplete="email" />
        </label>{' '}
        <button type="submit">Send code</button>
      </form>
      <form action="/logout" method="post">
        <button type="submit">Sign out</button>
      </form>
    </main>
  )
}
