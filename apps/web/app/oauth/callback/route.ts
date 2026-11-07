import { NextResponse } from 'next/server'
import { currentDid, oauthClient, setSessionCookie } from '../../../lib/auth'
import { linkFromSession, type LinkOutcome } from '../../../lib/link'
import { PUBLIC_URL } from '../../../lib/oauth'
import { limitedResult } from '../../../lib/rate-guard'
import { limitedResponse } from '../../../lib/rate-limit'

export const dynamic = 'force-dynamic'

// Redirect against PUBLIC_URL: behind the proxy, req.url carries the bind address (0.0.0.0:3000).
function back(path: string, key: string, value: string) {
  return NextResponse.redirect(new URL(`${path}?${key}=${encodeURIComponent(value)}`, PUBLIC_URL), 303)
}

export async function GET(req: Request) {
  const gate = await limitedResult(['callback.ip'])
  if (!gate.ok) return limitedResponse(gate.retryAfterSec)
  let result: { did: string; state: string | null; outcome?: LinkOutcome }
  try {
    const client = await oauthClient()
    const { session, state } = await client.callback(new URL(req.url).searchParams)
    result = { did: session.did, state }
    if (state === 'link') {
      // The email-scoped session is short lived: read the email, then revoke it.
      try {
        result.outcome = (await currentDid()) === session.did
          ? await linkFromSession(session)
          : { kind: 'error', message: 'Sign in again before linking an email.' }
      } finally {
        await session.signOut().catch(() => undefined)
      }
    }
  } catch (err) {
    console.error('oauth callback failed', err instanceof Error ? err.message : 'unknown')
    return back('/login', 'error', 'Sign-in did not complete. Try again.')
  }

  if (result.state !== 'link') {
    await setSessionCookie(result.did)
    return NextResponse.redirect(new URL('/account', PUBLIC_URL), 303)
  }
  const o = result.outcome!
  if (o.kind === 'linked') return back('/account', 'linked', o.masked)
  if (o.kind === 'code_sent') return NextResponse.redirect(new URL('/account/verify', PUBLIC_URL), 303)
  return back('/account', 'error', o.message)
}
