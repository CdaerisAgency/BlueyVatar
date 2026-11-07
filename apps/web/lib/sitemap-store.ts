/**
 * Profiles the sitemap may list (issue #141). A profile is listed only when the hosted page would show it
 * to an anonymous visitor: the repo is active, the user has a handle and a service profile record, the
 * visibility rules are public (spec section 10.2), and the account carries no `!no-unauthenticated`
 * label (spec section 9). Restricted profiles answer like unlinked hashes, so they must never appear here.
 * Profiles on a verified custom domain are left out too: their canonical URL is on that domain.
 */
import type pg from 'pg'
import { selfLabelValues } from '@blueyvatar/core'
import { TtlCache } from './host-cache'
import { SITEMAP_MAX_URLS } from './seo'

const ELIGIBLE = `
  FROM profiles p
  JOIN repos r ON r.did = p.did
  LEFT JOIN visibility_rules v ON v.did = p.did
  LEFT JOIN custom_domains cd ON cd.did = p.did AND cd.status = 'active'
  WHERE r.active AND r.handle IS NOT NULL
    AND NOT coalesce(v.hidden_profile, false)
    AND NOT coalesce(v.keyed_only, false)
    AND coalesce(cardinality(v.domain_allowlist), 0) = 0
    AND cd.did IS NULL`

export interface SitemapProfile { did: string; handle: string; updatedAt: Date }

export async function countEligibleProfiles(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n ${ELIGIBLE}`)
  return Number(rows[0]?.n ?? 0)
}

/** One page of eligible profiles in a stable order. */
export async function eligibleProfiles(pool: pg.Pool, limit = SITEMAP_MAX_URLS, offset = 0): Promise<SitemapProfile[]> {
  const { rows } = await pool.query<{ did: string; handle: string; indexed_at: Date }>(
    `SELECT p.did, r.handle, p.indexed_at ${ELIGIBLE} ORDER BY p.did LIMIT $1 OFFSET $2`,
    [limit, offset],
  )
  return rows.map((r) => ({ did: r.did, handle: r.handle, updatedAt: r.indexed_at }))
}

export type LabelCheck = (did: string) => Promise<boolean>

const APPVIEW = () => (process.env.BSKY_APPVIEW_URL || 'https://public.api.bsky.app').replace(/\/+$/, '')
const labelCache = new TtlCache<boolean>(6 * 60 * 60 * 1000, 100_000)

/**
 * True when the Bluesky profile can be read without a login and has no `!no-unauthenticated` self-label.
 * It fails closed: a failed or non-200 read counts as hidden, so a labeled account is never listed by accident.
 */
export function bskyLabelCheck(fetchImpl: typeof fetch = fetch): LabelCheck {
  return async (did) => {
    const hit = labelCache.get(did)
    if (hit) return hit.value
    let ok = false
    try {
      const res = await fetchImpl(`${APPVIEW()}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const body = (await res.json()) as { labels?: { val?: unknown }[] }
        ok = !selfLabelValues({ values: (body.labels ?? []).map((l) => ({ val: l.val })) }).includes('!no-unauthenticated')
      }
    } catch {
      ok = false
    }
    labelCache.set(did, ok, ok ? undefined : 10 * 60 * 1000)
    return ok
  }
}

/** Keeps the profiles whose account passes the label check, with a small fixed concurrency. */
export async function filterByLabel(profiles: SitemapProfile[], check: LabelCheck, concurrency = 8): Promise<SitemapProfile[]> {
  const keep = new Array<boolean>(profiles.length).fill(false)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, profiles.length) }, async () => {
      while (next < profiles.length) {
        const i = next++
        keep[i] = await check(profiles[i]!.did)
      }
    }),
  )
  return profiles.filter((_, i) => keep[i])
}
