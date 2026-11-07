import type { MetadataRoute } from 'next'
import { absoluteUrl, ROBOTS_ALLOW, ROBOTS_DISALLOW } from '../lib/site'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: [...ROBOTS_ALLOW], disallow: [...ROBOTS_DISALLOW] },
    sitemap: absoluteUrl('/sitemap.xml'),
  }
}
