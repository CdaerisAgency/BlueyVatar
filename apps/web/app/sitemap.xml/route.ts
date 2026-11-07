import { siteUrl } from '../../lib/site'
import { rootSitemap } from '../../lib/sitemap'
import { pgSitemapSource } from '../../lib/sitemap-source'

// Built per request from the database. Responses are cached by the CDN for an hour.
export const dynamic = 'force-dynamic'

/** Not app/sitemap.ts: that convention cannot emit a sitemap index, which this file needs past 50,000 URLs. */
export async function GET() {
  const xml = await rootSitemap(pgSitemapSource(), siteUrl())
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } })
}
