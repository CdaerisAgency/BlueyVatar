import { requireAdmin } from '../../../../../lib/admin/guard'
import { fetchReviewBlob } from '../../../../../lib/admin/blob'
import { getCase } from '../../../../../lib/admin/review'

export const dynamic = 'force-dynamic'

const none = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })

/**
 * The image of a case, for the reviewer who holds it. Answers 404 for child-safety cases (never shown), for anyone who does not
 * hold the lock, and for a CID that is not an image of the account. Never cached.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { did, pool } = await requireAdmin()
  const id = Number((await params).id)
  const cid = new URL(req.url).searchParams.get('cid') ?? ''
  if (!Number.isSafeInteger(id) || !/^[A-Za-z0-9]{10,200}$/.test(cid)) return none()
  const c = await getCase(pool, id)
  if (!c || c.child_safety || c.locked_by !== did || !c.locked_until || c.locked_until < new Date()) return none()
  const known = c.subject_cid === cid || (await pool.query('SELECT 1 FROM images WHERE did = $1 AND cid = $2', [c.subject_did, cid])).rowCount
  if (!known) return none()
  const blob = await fetchReviewBlob(c.subject_did, cid)
  if (!blob) return none()
  return new Response(blob.bytes as BodyInit, {
    headers: {
      'content-type': blob.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox", 'x-robots-tag': 'noindex',
    },
  })
}
