/** Canonical site URL, robots rules, and page metadata helpers (issue #141). */
import { formatPrice, PRICING } from './pricing'

export const DEFAULT_SITE_URL = 'https://blueyvatar.com'

/** Public origin of the site, no trailing slash. PUBLIC_URL overrides it; a value that is not an http(s) URL falls back to the default. */
export function siteUrl(raw: string | undefined = process.env.PUBLIC_URL): string {
  try {
    const u = new URL(raw || DEFAULT_SITE_URL)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return DEFAULT_SITE_URL
    return u.origin
  } catch {
    return DEFAULT_SITE_URL
  }
}

export const absoluteUrl = (path: string, base: string = siteUrl()): string => `${base}${path.startsWith('/') ? path : `/${path}`}`

/** Default Open Graph image for the site and for profiles without an avatar. */
export const DEFAULT_OG_IMAGE_PATH = '/logo.jpg'
export const defaultOgImage = (base: string = siteUrl()): string => absoluteUrl(DEFAULT_OG_IMAGE_PATH, base)

/** Indexable static pages. The sitemap lists these. */
export const STATIC_PAGES = ['/', '/pricing', '/integrations', '/gravatar-alternative', '/migrate-from-gravatar', '/policy', '/privacy', '/accessibility', '/changelog', '/docs'] as const

export const ROBOTS_ALLOW = ['/', '/p/', '/a/', '/pricing', '/integrations', '/gravatar-alternative', '/migrate-from-gravatar', '/policy', '/privacy', '/accessibility', '/changelog', '/docs'] as const
export const ROBOTS_DISALLOW = ['/account', '/oauth', '/login', '/logout', '/report', '/api', '/admin'] as const

/** Metadata for a static page: canonical URL plus Open Graph and Twitter fields with the default image. */
export function pageMetadata(path: string, title: string, description: string, base: string = siteUrl()) {
  const url = absoluteUrl(path, base)
  const images = [defaultOgImage(base)]
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'blueyvatar', type: 'website' as const, images },
    twitter: { card: 'summary' as const, title, description, images },
  }
}

/** Search description for /pricing, built from the same table the page renders. */
export function pricingDescription(): string {
  const tiers = PRICING.map((t) => `${t.name} ${formatPrice(t.amount)}${t.per ? `/${t.per}` : ''}`).join(', ')
  return `blueyvatar pricing: ${tiers}. Being seen is always free.`
}
