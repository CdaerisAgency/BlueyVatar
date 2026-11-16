import { NextResponse } from 'next/server'
import { callbackClient, currentDid, setSessionCookie, takeNext } from '../../../lib/auth'
import { linkFromSession, type LinkOutcome } from '../../../lib/link'
import { PUBLIC_URL } from '../../../lib/oauth'
import { reportError } from '../../../lib/obs'
import { limitedResult } from '../../../lib/rate-guard'
import { limitedResponse } from '../../../lib/rate-limit'
import { trackAccountInTap } from '../../../lib/tap'

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
    const params = new URL(req.url).searchParams
    const { session, state } = await (await callbackClient(params)).callback(params)
    result = { did: session.did, state }
    if (state === 'link') {
      // The email-scoped session lives in the link store (link:<did>), apart from the main session. Read the email, then revoke it.
      try {
        result.outcome = (await currentDid()) === session.did
          ? await linkFromSession(session)
          : { kind: 'error', message: 'Sign in again before linking an email.' }
      } finally {
        await session.signOut().catch(() => undefined)
      }
    }
  } catch (err) {
    reportError('oauth callback failed', err)
    return back('/login', 'error', 'Sign-in did not complete. Try again.')
  }

  if (result.state !== 'link') {
    await setSessionCookie(result.did)
    await trackAccountInTap(result.did) // best effort: asks Tap to follow the account (#223)
    return NextResponse.redirect(new URL(await takeNext(), PUBLIC_URL), 303)
  }
  const o = result.outcome!
  if (o.kind === 'linked') return NextResponse.redirect(new URL('/account', PUBLIC_URL), 303)
  if (o.kind === 'code_sent') return NextResponse.redirect(new URL('/account/verify', PUBLIC_URL), 303)
  return back('/account', 'error', o.message)
}
