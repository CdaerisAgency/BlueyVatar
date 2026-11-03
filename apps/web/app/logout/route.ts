import { NextResponse } from 'next/server'
import { clearSessionCookie, currentDid, oauthClient } from '../../lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const did = await currentDid()
  if (did) await (await oauthClient()).revoke(did).catch(() => undefined)
  await clearSessionCookie()
  return NextResponse.redirect(new URL('/', req.url), 303)
}
