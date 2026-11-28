import type pg from 'pg'
import { log } from './obs.js'

export interface OverLimitAsset { bytes: Buffer; mime: string; sha256: string }

const FAILURE_TTL_MS = 10_000

/**
 * Reads the over-limit avatar from site_assets, cached in memory for ttlMs. A missing table (SQLSTATE 42P01)
 * or row means no upload. Any other error keeps the last good value (or null) for a short time, so a database
 * outage is not hammered. Concurrent refreshes share one query.
 */
export function pgOverLimitAsset(pool: pg.Pool, ttlMs = 60_000): { get(): Promise<OverLimitAsset | null> } {
  let cached: { until: number; value: OverLimitAsset | null } | null = null
  let inflight: Promise<OverLimitAsset | null> | null = null

  async function load(): Promise<OverLimitAsset | null> {
    try {
      const { rows } = await pool.query<{ image: Buffer; mime: string; sha256: string }>(
        "SELECT image, mime, sha256 FROM site_assets WHERE name = 'over_limit_avatar'")
      const value = rows[0] ? { bytes: rows[0].image, mime: rows[0].mime, sha256: rows[0].sha256 } : null
      cached = { until: Date.now() + ttlMs, value }
      return value
    } catch (err) {
      if ((err as { code?: string } | null)?.code === '42P01') {
        log.warn('site_assets table is missing; no over-limit avatar')
        cached = { until: Date.now() + ttlMs, value: null }
        return null
      }
      log.warn('over-limit avatar load failed; serving the last good value', { err })
      const value = cached?.value ?? null
      cached = { until: Date.now() + Math.min(FAILURE_TTL_MS, ttlMs), value }
      return value
    }
  }

  return {
    async get() {
      if (cached && Date.now() < cached.until) return cached.value
      inflight ??= load().finally(() => { inflight = null })
      return inflight
    },
  }
}
