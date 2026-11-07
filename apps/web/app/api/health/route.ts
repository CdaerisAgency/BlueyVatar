import { REQUEST_ID_HEADER, requestIdFrom } from '@blueyvatar/core'
import { getPool } from '../../../lib/store'
import { log } from '../../../lib/obs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Readiness: `SELECT 1` against Postgres within READY_TIMEOUT_MS (default 3000). Without DATABASE_URL (local dev) it answers ok. */
export async function GET(req: Request): Promise<Response> {
  const requestId = requestIdFrom(req.headers.get(REQUEST_ID_HEADER))
  const headers = { 'cache-control': 'no-store', [REQUEST_ID_HEADER]: requestId }
  const pool = getPool()
  if (!pool) return Response.json({ status: 'ok', database: 'not configured' }, { headers })
  const budget = Number(process.env.READY_TIMEOUT_MS ?? 3000) || 3000
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('readiness check timed out')), budget) }),
    ])
    return Response.json({ status: 'ok' }, { headers })
  } catch (err) {
    log.error('readiness check failed', { requestId, err })
    return Response.json({ error: { code: 'not_ready', message: 'Database check failed', request_id: requestId } }, { status: 503, headers })
  } finally {
    clearTimeout(timer)
  }
}
