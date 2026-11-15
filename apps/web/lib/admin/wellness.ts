import { MAX_BLUR_PX, WELLNESS_DEFAULTS } from '@blueyvatar/core/moderation'
import type pg from 'pg'
import { recordAction } from './moderation'
import { getCase, type Q } from './review-queue'

export type Wellness = { blurPx: number; grayscale: boolean }
export async function getWellness(q: Q, did: string): Promise<Wellness> {
  const { rows } = await q.query<{ blur_px: number; grayscale: boolean }>('SELECT blur_px, grayscale FROM reviewer_prefs WHERE did = $1', [did])
  return rows[0] ? { blurPx: rows[0].blur_px, grayscale: rows[0].grayscale } : { ...WELLNESS_DEFAULTS }
}

export async function saveWellness(q: Q, did: string, w: { blurPx: unknown; grayscale: unknown }): Promise<Wellness> {
  const blur = Math.min(MAX_BLUR_PX, Math.max(0, Math.round(Number(w.blurPx))))
  const out = { blurPx: Number.isFinite(blur) ? blur : WELLNESS_DEFAULTS.blurPx, grayscale: w.grayscale === true || w.grayscale === 'on' }
  await q.query(
    `INSERT INTO reviewer_prefs (did, blur_px, grayscale) VALUES ($1, $2, $3)
     ON CONFLICT (did) DO UPDATE SET blur_px = EXCLUDED.blur_px, grayscale = EXCLUDED.grayscale, updated_at = now()`,
    [did, out.blurPx, out.grayscale],
  )
  return out
}

/** Writes a reveal to the audit log. Only the reviewer holding the case can reveal, and never in a child-safety case. */
export async function logReveal(pool: pg.Pool, actor: string, caseId: number, cid: string, now: Date = new Date()): Promise<boolean> {
  const c = await getCase(pool, caseId)
  if (!c || c.child_safety || c.locked_by !== actor || !c.locked_until || c.locked_until < now) return false
  await recordAction(pool, actor, 'reveal_image', { did: c.subject_did, cid, caseId, reason: 'Reviewer revealed the image' })
  return true
}
