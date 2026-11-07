import { siteUrl } from '../../../lib/site'
import { staticSitemap } from '../../../lib/sitemap'

export function GET() {
  return new Response(staticSitemap(siteUrl()), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } })
}
