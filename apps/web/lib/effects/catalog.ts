import type { Plan } from '../records'

/**
 * The effects catalog (issues #218 and #283). Closed lists, so a saved look is always one of a few known values and
 * the number of rendered variants stays small. Each effect says who may use it. Admin-issued free effects (#308)
 * will add a grant check in `canUse` and nothing else here: the catalog and renderer stay as they are.
 */
export type FrameStyle = 'ring' | 'double' | 'dashed'
export type Badge = 'away'
export type EffectId = `frame:${FrameStyle}` | `badge:${Badge}`
export type Access = 'free' | 'plus'

export const FRAME_STYLES: readonly { id: FrameStyle; label: string; hint: string }[] = [
  { id: 'ring', label: 'Plain ring', hint: 'One solid ring around a round picture.' },
  { id: 'double', label: 'Double ring', hint: 'A thick ring and a thin one inside it.' },
  { id: 'dashed', label: 'Dashed ring', hint: 'A ring made of short dashes.' },
]

/** A fixed palette, not free hex colors: it keeps the look closed and every color readable on light and dark pages. */
export const FRAME_COLORS: readonly { id: string; label: string; hex: string }[] = [
  { id: 'orange', label: 'Orange', hex: '#f97316' },
  { id: 'blue', label: 'Blue', hex: '#2563eb' },
  { id: 'green', label: 'Green', hex: '#16a34a' },
  { id: 'pink', label: 'Pink', hex: '#db2777' },
  { id: 'purple', label: 'Purple', hex: '#7c3aed' },
  { id: 'black', label: 'Black', hex: '#111827' },
]

/** Plans per effect. Frames are Plus and above; the out-of-office badge is free (owner decisions on #218). */
export const EFFECT_ACCESS: Record<EffectId, Access> = {
  'frame:ring': 'plus',
  'frame:double': 'plus',
  'frame:dashed': 'plus',
  'badge:away': 'free',
}

/**
 * Whether an effect may be used now. `grants` is the room for #308: effect ids an admin issued to this account for a
 * window. Nothing passes grants yet, so today this is the plan check alone.
 */
export function canUse(effect: EffectId, plan: Plan, grants: readonly EffectId[] = []): boolean {
  return EFFECT_ACCESS[effect] === 'free' || plan === 'plus' || grants.includes(effect)
}

/** One look per profile for now. Per-image looks later can reuse this type as a field on one image. */
export type Look = { frame?: { style: FrameStyle; color: string }; badge?: Badge }

export const isFrameStyle = (v: unknown): v is FrameStyle => FRAME_STYLES.some((s) => s.id === v)
export const colorHex = (id: string): string | undefined => FRAME_COLORS.find((c) => c.id === id)?.hex

export type Check<T> = { ok: true; value: T } | { ok: false; error: string }

export function parseFrame(styleRaw: string, colorRaw: string): Check<NonNullable<Look['frame']>> {
  if (!isFrameStyle(styleRaw)) return { ok: false, error: 'Choose a frame style.' }
  if (!colorHex(colorRaw)) return { ok: false, error: 'Choose a frame color.' }
  return { ok: true, value: { style: styleRaw, color: colorRaw } }
}
