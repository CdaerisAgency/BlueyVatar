import { requireAdmin } from '../../../../lib/admin/guard'
import { OVER_LIMIT_ASSET } from '../../../../lib/admin/site-settings'

export const dynamic = 'force-dynamic'

const none = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })

/**
 * Preview of the stored over-limit avatar for the admin settings page. requireAdmin answers 404 to anyone who is not on ADMIN_DIDS
 * and sends an admin without a live admin session to the admin sign-in. Never cached or indexed. The bytes are the re-encoded PNG.
 */
export async function GET(): Promise<Response> {
  const { pool } = await requireAdmin()
  let image: Buffer | undefined
  try {
    const { rows } = await pool.query<{ image: Buffer }>('SELECT image FROM site_assets WHERE name = $1', [OVER_LIMIT_ASSET])
    image = rows[0]?.image
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code !== '42P01') throw err
  }
  if (!image) return none()
  return new Response(new Uint8Array(image), {
    headers: {
      'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox", 'x-robots-tag': 'noindex',
    },
  })
}
