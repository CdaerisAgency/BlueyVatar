import { redirect } from 'next/navigation'
import { qrSvg } from '@blueyvatar/core'
import { addEmail, linkEmail, makePrimary, unlink } from '../actions'
import { currentDid } from '../../lib/auth'
import { getClaimStore } from '../../lib/claim-store'
import { PLATFORM_LABELS } from '../../lib/claims'
import { listClaims, repoHandle } from '../../lib/claims-repo'
import { MAX_LINKED_EMAILS, HOLD_DAYS } from '../../lib/email-policy'
import { PUBLIC_URL } from '../../lib/oauth'
import { repoSession } from '../../lib/repo'
import { getStore } from '../../lib/store'

export const dynamic = 'force-dynamic'

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string; linked?: string; qr?: string }> }) {
  const did = await currentDid()
  if (!did) redirect('/login')
  const { error, linked, qr } = await searchParams
  const links = await getStore().links.list(did)

  // QR code for the user's own profile. The target can be a verified, visible platform.
  let handle: string | null = null
  const platforms = new Map<string, string>()
  try {
    const session = await repoSession(did)
    const [claims, h, attestations] = await Promise.all([listClaims(session), repoHandle(session), getClaimStore().latestAttestations(did)])
    handle = h
    const status = new Map(attestations.map((a) => [a.claimRkey, a]))
    for (const c of claims) {
      const a = status.get(c.rkey)
      if (a?.result === 'verified' && a.claimUri === c.value.uri && !c.value.hidden && c.value.uri.startsWith('https://')) {
        platforms.set(c.value.platform.toLowerCase(), PLATFORM_LABELS[c.value.platform] ?? c.value.platform)
      }
    }
  } catch {
    handle = null
  }
  const target = qr && platforms.has(qr) ? qr : ''
  const qrUrl = handle ? (target ? `${PUBLIC_URL}/go/${encodeURIComponent(handle)}/${target}` : `${PUBLIC_URL}/p/${handle}`) : null
  const svg = qrUrl ? qrSvg(qrUrl, 256) : null
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
      <h2>QR code</h2>
      {svg && qrUrl ? (
        <>
          <form method="get">
            <label>
              Target{' '}
              <select name="qr" defaultValue={target}>
                <option value="">Profile page</option>
                {[...platforms].map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </label>{' '}
            <button type="submit">Update</button>
          </form>
          <p>
            <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} alt={`QR code for ${qrUrl}`} width={256} height={256} />
          </p>
          <p>
            <code>{qrUrl}</code>
          </p>
          <p>
            <a href={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} download={`${handle}-qr.svg`}>Download SVG</a>
          </p>
        </>
      ) : (
        <p>Your QR code is unavailable until your handle can be loaded.</p>
      )}
      <form action="/logout" method="post">
        <button type="submit">Sign out</button>
      </form>
    </main>
  )
}
