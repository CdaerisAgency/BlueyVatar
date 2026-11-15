import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { reportError } from '../../../../lib/obs'
import { tickAway } from '../../../../lib/effects/flow'
import { liveDeps } from '../../../../lib/effects/live'

export const dynamic = 'force-dynamic'

function authorized(header: string | null): boolean {
  const secret = process.env.EFFECTS_TICK_SECRET
  if (!secret || !header?.startsWith('Bearer ')) return false
  const a = Buffer.from(header.slice(7)), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Called by the indexer job when an out-of-office window starts or ends. The web app does the work because only it
 * holds the OAuth keys that write to a user's repository. Off (404) until EFFECTS_TICK_SECRET is set. One account
 * per call; the step re-checks that it is due, so a repeat does nothing.
 */
export async function POST(req: Request): Promise<Response> {
  if (!process.env.EFFECTS_TICK_SECRET) return new NextResponse(null, { status: 404 })
  if (!authorized(req.headers.get('authorization'))) return new NextResponse(null, { status: 401 })
  const did = ((await req.json().catch(() => ({}))) as { did?: unknown }).did
  if (typeof did !== 'string' || !/^did:[a-z]+:[A-Za-z0-9._:%-]{1,512}$/.test(did)) return NextResponse.json({ error: 'bad did' }, { status: 400 })
  try {
    return NextResponse.json({ result: await tickAway(await liveDeps(did), did) })
  } catch (err) {
    reportError('effects tick failed', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
