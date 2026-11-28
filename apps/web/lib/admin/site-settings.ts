import { createHash } from 'node:crypto'
import type pg from 'pg'
import sharp from 'sharp'
import { SETTING_DEFS, validateSetting, type SettingKey, type SettingRow } from '@blueyvatar/core/settings'
import { inTx, recordAction } from './moderation'
import { isMissingTable, listSettingRows } from '../setting-rows'

/** Admin-edited limits (site_settings) and the over-limit avatar (site_assets). Every write is audited in the same transaction. */

type Q = Pick<pg.Pool, 'query'>

export const OVER_LIMIT_ASSET = 'over_limit_avatar'
export const ASSET_MAX_BYTES = 2 * 1024 * 1024
export const ASSET_MAX_EDGE = 1024
/** A decoded picture larger than this many pixels is refused before it is opened (same cap as report screenshots). */
const MAX_PIXELS = 40_000_000

export { listSettingRows }

/** Key order does not matter: jsonb does not keep it, so compare in a canonical form. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

const defaultFor = (key: SettingKey): unknown => SETTING_DEFS.find((d) => d.key === key)!.default

export type SaveResult = { ok: true; changed: SettingKey[] } | { ok: false; errors: Record<string, string> }

/**
 * Validates every change first; if any is invalid nothing is written. Otherwise upserts the keys whose value differs from the
 * one now in effect (the stored row, or the code default when there is none) and writes one audit row per changed key,
 * all in one transaction. The last entry wins when a key is listed twice.
 */
export async function saveSettings(pool: pg.Pool, actor: string, changes: { key: string; value: unknown }[]): Promise<SaveResult> {
  const errors: Record<string, string> = {}
  const valid = new Map<SettingKey, unknown>()
  for (const ch of changes) {
    const r = validateSetting(ch.key, ch.value)
    if (r.ok) valid.set(r.key, r.value)
    else errors[ch.key] = r.error
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  if (valid.size === 0) return { ok: true, changed: [] }

  return inTx(pool, async (c) => {
    // FOR UPDATE locks nothing when a key has no row yet, so serialize saves first; `before` is then read under the lock.
    await c.query("SELECT pg_advisory_xact_lock(hashtext('site_settings'))")
    const { rows } = await c.query<SettingRow>('SELECT key, value FROM site_settings WHERE key = ANY($1::text[]) FOR UPDATE', [[...valid.keys()]])
    const stored = new Map(rows.map((r) => [r.key, r.value]))
    const changed: SettingKey[] = []
    for (const [key, value] of valid) {
      const before = stored.has(key) ? stored.get(key) : defaultFor(key)
      if (canon(before) === canon(value)) continue
      await c.query(
        `INSERT INTO site_settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, JSON.stringify(value), actor],
      )
      await recordAction(c, actor, 'settings_change', { detail: { key, before, after: value } })
      changed.push(key)
    }
    return { ok: true as const, changed }
  })
}

/** Deletes the row so the code default applies again. A no-op (no audit row) when there is no row to delete. */
export async function resetSetting(pool: pg.Pool, actor: string, key: SettingKey): Promise<void> {
  await inTx(pool, async (c) => {
    const { rows } = await c.query<{ value: unknown }>('DELETE FROM site_settings WHERE key = $1 RETURNING value', [key])
    if (rows.length === 0) return
    await recordAction(c, actor, 'settings_change', { detail: { key, before: rows[0]!.value, after: 'default' } })
  })
}

export type AssetMeta = { sha256: string; width: number; height: number; mime: string; updatedAt: Date }

/** Metadata only (never the bytes). Null when there is no asset, or the table does not exist yet. */
export async function getAssetMeta(q: Q, name: typeof OVER_LIMIT_ASSET): Promise<AssetMeta | null> {
  try {
    const { rows } = await q.query<{ sha256: string; width: number; height: number; mime: string; updated_at: Date }>(
      'SELECT sha256, width, height, mime, updated_at FROM site_assets WHERE name = $1',
      [name],
    )
    const r = rows[0]
    return r ? { sha256: r.sha256, width: r.width, height: r.height, mime: r.mime, updatedAt: r.updated_at } : null
  } catch (err) {
    if (isMissingTable(err)) return null
    throw err
  }
}

/** Re-encodes to a metadata-free square PNG, center-cropped, edge at most ASSET_MAX_EDGE. Null when it is not a PNG, JPEG, or WebP picture. */
async function squarePng(input: Buffer): Promise<{ image: Buffer; width: number; height: number } | null> {
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata()
    if (!meta.format || !['png', 'jpeg', 'webp'].includes(meta.format) || !meta.width || !meta.height) return null
    const swap = (meta.orientation ?? 1) >= 5
    const w = swap ? meta.height : meta.width
    const h = swap ? meta.width : meta.height
    const edge = Math.min(w, h, ASSET_MAX_EDGE)
    const { data, info } = await sharp(input, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize(edge, edge, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer({ resolveWithObject: true })
    return { image: data, width: info.width, height: info.height }
  } catch {
    return null
  }
}

export async function putOverLimitAsset(pool: pg.Pool, actor: string, image: Buffer): Promise<{ ok: true } | { ok: false; error: string }> {
  if (image.length === 0 || image.length > ASSET_MAX_BYTES) return { ok: false, error: 'The image must be 2 MB or smaller.' }
  const out = await squarePng(image)
  if (!out) return { ok: false, error: 'Upload a PNG, JPEG, or WebP image.' }
  const sha = createHash('sha256').update(out.image).digest('hex')
  await inTx(pool, async (c) => {
    const { rows } = await c.query<{ sha256: string }>('SELECT sha256 FROM site_assets WHERE name = $1 FOR UPDATE', [OVER_LIMIT_ASSET])
    await c.query(
      `INSERT INTO site_assets (name, image, mime, width, height, sha256, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (name) DO UPDATE SET image = EXCLUDED.image, mime = EXCLUDED.mime, width = EXCLUDED.width, height = EXCLUDED.height,
         sha256 = EXCLUDED.sha256, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [OVER_LIMIT_ASSET, out.image, 'image/png', out.width, out.height, sha, actor],
    )
    await recordAction(c, actor, 'asset_change', { detail: { name: OVER_LIMIT_ASSET, before: rows[0]?.sha256 ?? null, after: sha } })
  })
  return { ok: true }
}

export async function removeOverLimitAsset(pool: pg.Pool, actor: string): Promise<void> {
  await inTx(pool, async (c) => {
    const { rows } = await c.query<{ sha256: string }>('SELECT sha256 FROM site_assets WHERE name = $1 FOR UPDATE', [OVER_LIMIT_ASSET])
    await c.query('DELETE FROM site_assets WHERE name = $1', [OVER_LIMIT_ASSET])
    await recordAction(c, actor, 'asset_change', { detail: { name: OVER_LIMIT_ASSET, before: rows[0]?.sha256 ?? null, after: null } })
  })
}
