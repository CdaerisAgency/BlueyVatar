import { getPool } from './store'
import { bskyLabelCheck, countEligibleProfiles, eligibleProfiles } from './sitemap-store'
import type { SitemapSource } from './sitemap'

/** The Postgres-backed source. Without DATABASE_URL (local dev) the sitemap lists static pages only. */
export function pgSitemapSource(): SitemapSource {
  const pool = getPool()
  return {
    count: async () => (pool ? countEligibleProfiles(pool) : 0),
    page: async (limit, offset) => (pool ? eligibleProfiles(pool, limit, offset) : []),
    check: bskyLabelCheck(),
  }
}
