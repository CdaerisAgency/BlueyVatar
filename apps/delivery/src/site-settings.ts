import type pg from 'pg'
import type { SettingRow } from '@blueyvatar/core/settings'
import { log } from './obs.js'

/** Loads every row of site_settings. A missing table (SQLSTATE 42P01, migration 0046 not applied yet) means no overrides. */
export function pgSettingRows(pool: pg.Pool): () => Promise<SettingRow[]> {
  return async () => {
    try {
      const { rows } = await pool.query<SettingRow>('SELECT key, value FROM site_settings')
      return rows
    } catch (err) {
      if ((err as { code?: string } | null)?.code === '42P01') {
        log.warn('site_settings table is missing; serving default settings')
        return []
      }
      throw err
    }
  }
}
