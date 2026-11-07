import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { currentDid } from '../../../../lib/auth'
import { repoHandle } from '../../../../lib/claims-repo'
import { CHECKLIST_COOKIE, parsePrefs, serializePrefs } from '../../../../lib/onboarding'
import { PUBLIC_URL } from '../../../../lib/oauth'
import { repoSession } from '../../../../lib/repo'

export const dynamic = 'force-dynamic'

/** The checklist's "view your public profile" step: remember the visit, then send the user to /p/{handle}. Safe to repeat. */
export async function GET() {
  const did = await currentDid()
  if (!did) return NextResponse.redirect(new URL('/login?next=%2Faccount', PUBLIC_URL), 303)
  const handle = await repoHandle(await repoSession(did)).catch(() => null)
  const res = NextResponse.redirect(new URL(handle ? `/p/${encodeURIComponent(handle)}` : '/account', PUBLIC_URL), 303)
  const prefs = parsePrefs((await cookies()).get(CHECKLIST_COOKIE)?.value)
  if (handle) res.cookies.set(CHECKLIST_COOKIE, serializePrefs({ ...prefs, viewed: true }), { path: '/account', maxAge: 365 * 24 * 3600, sameSite: 'lax', httpOnly: true })
  return res
}
