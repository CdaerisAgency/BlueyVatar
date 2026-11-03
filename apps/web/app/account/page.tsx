import { redirect } from 'next/navigation'
import { addEmail, linkEmail, unlink } from '../actions'
import { currentDid } from '../../lib/auth'
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
      <h2>Linked emails</h2>
      {links.length === 0 ? (
        <p>No email linked yet.</p>
      ) : (
        <ul>
          {links.map((l) => (
            <li key={l.emailHash}>
              <code>{l.emailHash}</code> ({l.method}){' '}
              <form action={unlink} style={{ display: 'inline' }}>
                <input type="hidden" name="hash" value={l.emailHash} />
                <button type="submit">Unlink</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <h2>Link email</h2>
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
