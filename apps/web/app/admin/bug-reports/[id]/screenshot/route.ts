import { requireAdmin } from '../../../../../lib/admin/guard'
import { getScreenshot } from '../../../../../lib/bug-report-screenshot'

export const dynamic = 'force-dynamic'

const none = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })

/**
 * The screenshot of a bug report (issue #266), linked from the GitHub issue the report filed. requireAdmin answers 404 to anyone who is not
 * on ADMIN_DIDS, and sends an admin without a live admin session (password and TOTP step) to the admin sign-in. Never cached or indexed.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { pool } = await requireAdmin()
  const id = (await params).id
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(id)) return none()
  const image = await getScreenshot(pool, id)
  if (!image) return none()
  return new Response(new Uint8Array(image), {
    headers: {
      'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox", 'x-robots-tag': 'noindex',
    },
  })
}
