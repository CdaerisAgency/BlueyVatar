'use server'

import { redirect } from 'next/navigation'
import { clearSessionCookie, currentSession, oauthClient } from '../../../lib/auth'
import { log, reportError } from '../../../lib/obs'
import { limited } from '../../../lib/rate-guard'
import { getStore } from '../../../lib/store'

const back = (key: 'error' | 'done', msg: string): never => redirect(`/account/settings?${key}=${encodeURIComponent(msg)}#sessions`)

/** Signs out one other session. Signing out this browser goes through /logout. */
export async function signOutSession(form: FormData): Promise<void> {
  const s = await currentSession()
  if (!s) return redirect('/login?next=%2Faccount%2Fsettings')
  const wait = await limited(['session.did'], s.did)
  if (wait) return back('error', wait)
  const id = String(form.get('id') ?? '')
  if (id === s.sid) return back('error', 'Use Sign out to end this session.')
  const ok = await getStore().sessions.revoke(s.did, id)
  log.info('session revoked', { ok })
  return back('done', ok ? 'Signed that session out.' : 'That session was already gone.')
}

/** Ends every session for the account, this one included, and revokes the stored atproto tokens. */
export async function signOutEverywhere(): Promise<void> {
  const s = await currentSession()
  if (!s) return redirect('/login')
  const wait = await limited(['session.did'], s.did)
  if (wait) return back('error', wait)
  const removed = await getStore().sessions.revokeAll(s.did)
  await (await oauthClient()).revoke(s.did).catch((err) => reportError('oauth revoke failed during sign out everywhere', err))
  await clearSessionCookie()
  log.info('signed out everywhere', { removed })
  return redirect('/login')
}
