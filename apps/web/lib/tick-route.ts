import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { reportError } from './obs'

function authorized(header: string | null): boolean {
  const secret = process.env.EFFECTS_TICK_SECRET
  if (!secret || !header?.startsWith('Bearer ')) return false
  const a = Buffer.from(header.slice(7)), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The POST handler of a job-called tick route. Off (404) until EFFECTS_TICK_SECRET is set; 401 for a wrong or missing
 * bearer token; 400 for a body without a DID; 500 when `tick` throws. One account per call.
 * Each route file still sets `export const dynamic = 'force-dynamic'` itself, because Next reads that statically.
 */
export function makeTickRoute(label: string, tick: (did: string) => Promise<unknown>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (!process.env.EFFECTS_TICK_SECRET) return new NextResponse(null, { status: 404 })
    if (!authorized(req.headers.get('authorization'))) return new NextResponse(null, { status: 401 })
    const did = ((await req.json().catch(() => ({}))) as { did?: unknown }).did
    if (typeof did !== 'string' || !/^did:[a-z]+:[A-Za-z0-9._:%-]{1,512}$/.test(did)) return NextResponse.json({ error: 'bad did' }, { status: 400 })
    try {
      return NextResponse.json({ result: await tick(did) })
    } catch (err) {
      reportError(`${label} tick failed`, err)
      return NextResponse.json({ error: 'failed' }, { status: 500 })
    }
  }
}
