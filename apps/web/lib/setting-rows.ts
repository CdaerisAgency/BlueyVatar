import type pg from 'pg'
import type { SettingRow } from '@blueyvatar/core/settings'

/** Reading stored settings only. Kept apart from lib/admin/site-settings.ts so public pages do not load sharp or moderation. */
type Q = Pick<pg.Pool, 'query'>

export const isMissingTable = (err: unknown): boolean => typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '42P01'

/** Stored rows. An empty list when the table does not exist yet (the app can deploy before migration 0046 runs). */
export async function listSettingRows(q: Q): Promise<SettingRow[]> {
  try {
    const { rows } = await q.query<SettingRow>('SELECT key, value FROM site_settings ORDER BY key')
    return rows
  } catch (err) {
    if (isMissingTable(err)) return []
    throw err
  }
}
