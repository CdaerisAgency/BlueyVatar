import { siteUrl } from '../../../../lib/site'
import { profilesSitemap } from '../../../../lib/sitemap'
import { pgSitemapSource } from '../../../../lib/sitemap-source'

export const dynamic = 'force-dynamic'

/** /sitemap/profiles/{n}.xml, n counted from 0. */
export async function GET(_req: Request, { params }: { params: Promise<{ page: string }> }) {
  const m = /^(\d{1,6})\.xml$/.exec((await params).page)
  if (!m) return new Response('Not found', { status: 404 })
  const xml = await profilesSitemap(pgSitemapSource(), siteUrl(), Number(m[1]))
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } })
}
