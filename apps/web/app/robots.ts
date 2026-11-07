import type { MetadataRoute } from 'next'

/** Keeps the admin pages out of search results. There is no sitemap entry for them either. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/admin'] }] }
}
