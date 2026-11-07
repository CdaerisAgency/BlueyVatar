import { NextResponse } from 'next/server'
import { clearSessionCookie, currentSession, oauthClient } from '../../lib/auth'
import { PUBLIC_URL } from '../../lib/oauth'
import { getStore } from '../../lib/store'

export const dynamic = 'force-dynamic'

export async function POST() {
  const s = await currentSession()
  if (s?.sid) await getStore().sessions.revoke(s.did, s.sid).catch(() => undefined)
  if (s) await (await oauthClient()).revoke(s.did).catch(() => undefined)
  await clearSessionCookie()
  return NextResponse.redirect(new URL('/', PUBLIC_URL), 303)
}
