/** Builds the sitemap documents from injected sources, so the exclusion rules are testable without Next or Postgres. */
import { absoluteUrl, STATIC_PAGES } from './site'
import { profileCanonical, SITEMAP_MAX_URLS, sitemapIndexXml, urlsetXml, type SitemapEntry } from './seo'
import { filterByLabel, type LabelCheck, type SitemapProfile } from './sitemap-store'

export interface SitemapSource {
  count(): Promise<number>
  page(limit: number, offset: number): Promise<SitemapProfile[]>
  check: LabelCheck
}

export const staticEntries = (base: string): SitemapEntry[] => STATIC_PAGES.map((p) => ({ url: absoluteUrl(p, base) }))

async function profileEntries(src: SitemapSource, base: string, limit: number, offset: number): Promise<SitemapEntry[]> {
  const rows = await filterByLabel(await src.page(limit, offset), src.check)
  return rows.map((r) => ({ url: profileCanonical(r.handle, null, base), lastModified: r.updatedAt }))
}

/** /sitemap.xml: one urlset while everything fits in 50,000 URLs, otherwise a sitemap index. */
export async function rootSitemap(src: SitemapSource, base: string, max = SITEMAP_MAX_URLS): Promise<string> {
  const statics = staticEntries(base)
  const total = await src.count()
  if (statics.length + total <= max) return urlsetXml([...statics, ...(await profileEntries(src, base, max, 0))])
  const pages = Math.ceil(total / max)
  return sitemapIndexXml([absoluteUrl('/sitemap/static.xml', base), ...Array.from({ length: pages }, (_, i) => absoluteUrl(`/sitemap/profiles/${i}.xml`, base))])
}

export const staticSitemap = (base: string): string => urlsetXml(staticEntries(base))

/** One page of profile URLs, `page` counted from 0. */
export async function profilesSitemap(src: SitemapSource, base: string, page: number, max = SITEMAP_MAX_URLS): Promise<string> {
  return urlsetXml(await profileEntries(src, base, max, page * max))
}
