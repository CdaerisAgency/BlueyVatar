import { NextResponse } from 'next/server'
import { currentDid, oauthClient, setSessionCookie } from '../../../lib/auth'
import { linkFromSession, type LinkOutcome } from '../../../lib/link'

export const dynamic = 'force-dynamic'

function back(req: Request, path: string, key: string, value: string) {
  return NextResponse.redirect(new URL(`${path}?${key}=${encodeURIComponent(value)}`, req.url), 303)
}

export async function GET(req: Request) {
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
    return back(req, '/login', 'error', 'Sign-in did not complete. Try again.')
  }

  if (result.state !== 'link') {
    await setSessionCookie(result.did)
    return NextResponse.redirect(new URL('/account', req.url), 303)
  }
  const o = result.outcome!
  if (o.kind === 'linked') return back(req, '/account', 'linked', o.masked)
  if (o.kind === 'code_sent') return NextResponse.redirect(new URL('/account/verify', req.url), 303)
  return back(req, '/account', 'error', o.message)
}
