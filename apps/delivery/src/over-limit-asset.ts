import type pg from 'pg'
import { log } from './obs.js'

export interface OverLimitAsset { bytes: Buffer; mime: string; sha256: string }

/** Reads the over-limit avatar from site_assets, cached in memory for ttlMs. A missing table (SQLSTATE 42P01) or row means no upload. */
export function pgOverLimitAsset(pool: pg.Pool, ttlMs = 60_000): { get(): Promise<OverLimitAsset | null> } {
  let cached: { at: number; value: OverLimitAsset | null } | null = null
  return {
    async get() {
      if (cached && Date.now() - cached.at < ttlMs) return cached.value
      let value: OverLimitAsset | null = null
      try {
        const { rows } = await pool.query<{ image: Buffer; mime: string; sha256: string }>(
          "SELECT image, mime, sha256 FROM site_assets WHERE name = 'over_limit_avatar'")
        if (rows[0]) value = { bytes: rows[0].image, mime: rows[0].mime, sha256: rows[0].sha256 }
      } catch (err) {
        if ((err as { code?: string } | null)?.code !== '42P01') throw err
        log.warn('site_assets table is missing; no over-limit avatar')
      }
      cached = { at: Date.now(), value }
      return value
    },
  }
}
