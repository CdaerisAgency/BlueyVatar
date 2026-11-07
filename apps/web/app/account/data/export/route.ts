import { NextResponse } from 'next/server'
import { exportAccountData } from '../../../../lib/account-data'
import { currentDid } from '../../../../lib/auth'
import { limitedResult } from '../../../../lib/rate-guard'
import { limitedResponse } from '../../../../lib/rate-limit'
import { getPool } from '../../../../lib/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const did = await currentDid()
  if (!did) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const r = await limitedResult(['export.did', 'export.ip'], did)
  if (!r.ok) return limitedResponse(r.retryAfterSec)
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'no_database', message: 'Export needs the database, which is not configured here.' }, { status: 503 })
  const data = await exportAccountData(pool, did)
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="blueyvatar-data.json"',
      'cache-control': 'no-store',
    },
  })
}
