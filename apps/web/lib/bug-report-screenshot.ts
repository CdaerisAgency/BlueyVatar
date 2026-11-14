import { randomBytes } from 'node:crypto'
import type pg from 'pg'
import sharp from 'sharp'
import { SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_EDGE } from './bug-report'

/** Server side of report screenshots (issue #266). Stored in Postgres, shown only to admins, deleted after 90 days (indexer). */

/** How long a screenshot is kept. The indexer job (apps/indexer/src/bug-report-retention.ts) uses the same number. */
export const SCREENSHOT_RETENTION_DAYS = 90
/** A decoded picture larger than this many pixels is refused before it is opened. */
const MAX_PIXELS = 40_000_000

type Q = Pick<pg.Pool, 'query'>

/**
 * Re-encodes whatever the browser sent as a JPEG with no metadata (sharp drops EXIF, GPS, and ICC data unless asked to keep
 * it), scaled to SCREENSHOT_MAX_EDGE and held under SCREENSHOT_MAX_BYTES. Null when the bytes are not a PNG, JPEG, or WebP picture,
 * or stay over the cap. The browser already does the same, so this is the check that does not trust the browser.
 */
export async function cleanScreenshot(input: Buffer): Promise<Buffer | null> {
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata()
    if (!meta.format || !['png', 'jpeg', 'webp'].includes(meta.format)) return null
    for (const quality of [72, 55, 40]) {
      const out = await sharp(input, { limitInputPixels: MAX_PIXELS })
        .rotate()
        .resize({ width: SCREENSHOT_MAX_EDGE, height: SCREENSHOT_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality })
        .toBuffer()
      if (out.length <= SCREENSHOT_MAX_BYTES) return out
    }
    return null
  } catch {
    return null
  }
}

/** Decodes the base64 the dialog sends (a bare string, or a data URL). Null when it is not base64 or is larger than the input cap. */
export function decodeScreenshot(raw: unknown, maxBytes: number): Buffer | null {
  if (typeof raw !== 'string' || raw === '') return null
  const b64 = raw.replace(/^data:image\/(?:png|jpeg|webp);base64,/, '')
  if (b64.length > Math.ceil((maxBytes * 4) / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null
  const buf = Buffer.from(b64, 'base64')
  return buf.length > 0 && buf.length <= maxBytes ? buf : null
}

export const newScreenshotId = (): string => randomBytes(18).toString('base64url')

export async function saveScreenshot(pool: Q, did: string, image: Buffer): Promise<string> {
  const id = newScreenshotId()
  await pool.query('INSERT INTO bug_report_screenshots (id, did, image) VALUES ($1, $2, $3)', [id, did, image])
  return id
}

export async function attachIssue(pool: Q, id: string, issueNumber: number): Promise<void> {
  await pool.query('UPDATE bug_report_screenshots SET issue_number = $2 WHERE id = $1', [id, issueNumber])
}

export async function deleteScreenshot(pool: Q, id: string): Promise<void> {
  await pool.query('DELETE FROM bug_report_screenshots WHERE id = $1', [id])
}

/** The picture for the admin route. Null when it does not exist or is past retention (the indexer may not have run yet). */
export async function getScreenshot(pool: Q, id: string, now: Date = new Date()): Promise<Buffer | null> {
  const r = await pool.query(`SELECT image FROM bug_report_screenshots WHERE id = $1 AND created_at > $2::timestamptz - make_interval(days => ${SCREENSHOT_RETENTION_DAYS})`, [id, now])
  return (r.rows[0]?.image as Buffer | undefined) ?? null
}
