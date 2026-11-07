import { createHash, timingSafeEqual } from 'node:crypto'
import { metrics } from '../../../lib/obs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const digest = (s: string) => createHash('sha256').update(s).digest()

/** Prometheus text format. Needs `Authorization: Bearer <METRICS_TOKEN>`; without METRICS_TOKEN the route answers 404. */
export async function GET(req: Request): Promise<Response> {
  const expected = process.env.METRICS_TOKEN
  const got = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '')?.[1]
  if (!expected || !got || !timingSafeEqual(digest(got), digest(expected))) return new Response('Not found', { status: 404 })
  return new Response(metrics.render(), { headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' } })
}
