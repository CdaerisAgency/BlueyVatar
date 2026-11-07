import { NextResponse } from 'next/server'
import { clearSessionCookie, currentDid, oauthClient } from '../../lib/auth'
import { PUBLIC_URL } from '../../lib/oauth'

export const dynamic = 'force-dynamic'

export async function POST() {
  const did = await currentDid()
  if (did) await (await oauthClient()).revoke(did).catch(() => undefined)
  await clearSessionCookie()
  return NextResponse.redirect(new URL('/', PUBLIC_URL), 303)
}
