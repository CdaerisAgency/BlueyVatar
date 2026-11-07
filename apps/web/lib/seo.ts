/** Profile canonical URLs, Person JSON-LD, and sitemap XML (issue #141). Pure helpers. */
import type { PublicProfile } from './profile-page'
import { pageLinks } from './profile-page'
import { absoluteUrl, siteUrl } from './site'

/** The hostname the profile is served from when the owner has a verified custom domain, otherwise /p/{handle} on the site. */
export function profileCanonical(handle: string, customHostname: string | null | undefined, base: string = siteUrl()): string {
  if (customHostname) return `https://${customHostname}/`
  return absoluteUrl(`/p/${encodeURIComponent(handle)}`, base)
}

const clean = (s: string | null | undefined): string | undefined => (typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined)

/**
 * Person JSON-LD from the fields the profile JSON already makes public. It never carries email data
 * (hashes included), the DID, the time zone, or accounts the user hid. Links are re-checked for https.
 */
export function personJsonLd(p: PublicProfile, canonical: string, imageBase: string): Record<string, unknown> {
  const name = clean(p.displayName) ?? clean(p.handle)
  const company = clean(p.company)
  const location = clean(p.location)
  const sameAs = [
    ...pageLinks(p).map((l) => l.url),
    ...(p.verifiedAccounts ?? []).filter((a) => !a.hidden && /^https:\/\//.test(a.uri)).map((a) => a.uri),
  ]
  const out: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    url: canonical,
    mainEntityOfPage: canonical,
  }
  if (name) out.name = name
  if (clean(p.handle) && clean(p.handle) !== name) out.alternateName = clean(p.handle)
  if (clean(p.description)) out.description = clean(p.description)
  if (p.avatar) out.image = `${imageBase.replace(/\/+$/, '')}${p.avatar.url}`
  if (clean(p.jobTitle)) out.jobTitle = clean(p.jobTitle)
  if (company) out.worksFor = { '@type': 'Organization', name: company }
  if (location) out.homeLocation = { '@type': 'Place', name: location }
  if (sameAs.length > 0) out.sameAs = [...new Set(sameAs)]
  return out
}

/** Serializes JSON-LD for a script tag. `<` is escaped so profile text can never close the tag. */
export const jsonLdString = (data: unknown): string => JSON.stringify(data).replace(/</g, '\\u003c')

export const SITEMAP_MAX_URLS = 50_000

export interface SitemapEntry { url: string; lastModified?: Date }

const xmlEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

export function urlsetXml(entries: readonly SitemapEntry[]): string {
  const body = entries
    .map((e) => `<url><loc>${xmlEscape(e.url)}</loc>${e.lastModified ? `<lastmod>${e.lastModified.toISOString()}</lastmod>` : ''}</url>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`
}

export function sitemapIndexXml(locs: readonly string[]): string {
  const body = locs.map((l) => `<sitemap><loc>${xmlEscape(l)}</loc></sitemap>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`
}
