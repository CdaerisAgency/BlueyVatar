import type { Plan } from '../records'

/**
 * The effects catalog (issues #218 and #283). Closed lists, so a saved look is always one of a few known values and
 * the number of rendered variants stays small. Each effect says who may use it. Admin-issued free effects (#308)
 * will add a grant check in `canUse` and nothing else here: the catalog and renderer stay as they are.
 */
export type FrameStyle = 'ring' | 'double' | 'dashed' | 'thick' | 'dotted' | 'inset'
export type FilterId = 'mono' | 'sepia' | 'warm' | 'cool' | 'contrast'
export type Badge = 'away'
export type EffectId = `frame:${FrameStyle}` | `filter:${FilterId}` | `badge:${Badge}`
export type Access = 'free' | 'plus'

export const FRAME_STYLES: readonly { id: FrameStyle; label: string; hint: string }[] = [
  { id: 'ring', label: 'Plain ring', hint: 'One solid ring around a round picture.' },
  { id: 'double', label: 'Double ring', hint: 'A thick ring and a thin one inside it.' },
  { id: 'dashed', label: 'Dashed ring', hint: 'A ring made of short dashes.' },
  { id: 'thick', label: 'Thick ring', hint: 'A wide, bold ring.' },
  { id: 'dotted', label: 'Dotted ring', hint: 'A ring made of round dots.' },
  { id: 'inset', label: 'Inset ring', hint: 'A thin ring set in from the edge, with a gap outside it.' },
]

/** Image filters. Each one is a fixed color change in render.ts, so there are no free settings. */
export const FILTERS: readonly { id: FilterId; label: string; hint: string }[] = [
  { id: 'mono', label: 'Black and white', hint: 'Removes all color.' },
  { id: 'sepia', label: 'Sepia', hint: 'An old-photo brown tone.' },
  { id: 'warm', label: 'Warm', hint: 'A little more red and yellow.' },
  { id: 'cool', label: 'Cool', hint: 'A little more blue.' },
  { id: 'contrast', label: 'High contrast', hint: 'Darker darks and lighter lights.' },
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

/** Plans per effect. Frames and filters are Plus and above; the out-of-office badge is free (owner decisions on #218). */
export const EFFECT_ACCESS: Record<EffectId, Access> = {
  'frame:ring': 'plus',
  'frame:double': 'plus',
  'frame:dashed': 'plus',
  'frame:thick': 'plus',
  'frame:dotted': 'plus',
  'frame:inset': 'plus',
  'filter:mono': 'plus',
  'filter:sepia': 'plus',
  'filter:warm': 'plus',
  'filter:cool': 'plus',
  'filter:contrast': 'plus',
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
/** A look may combine one frame and one filter, plus the out-of-office badge. */
export type Look = { frame?: { style: FrameStyle; color: string }; filter?: FilterId; badge?: Badge }

export const isFrameStyle = (v: unknown): v is FrameStyle => FRAME_STYLES.some((s) => s.id === v)
export const isFilterId = (v: unknown): v is FilterId => FILTERS.some((s) => s.id === v)
export const colorHex = (id: string): string | undefined => FRAME_COLORS.find((c) => c.id === id)?.hex

export type Check<T> = { ok: true; value: T } | { ok: false; error: string }

export function parseFrame(styleRaw: string, colorRaw: string): Check<NonNullable<Look['frame']>> {
  if (!isFrameStyle(styleRaw)) return { ok: false, error: 'Choose a frame style.' }
  if (!colorHex(colorRaw)) return { ok: false, error: 'Choose a frame color.' }
  return { ok: true, value: { style: styleRaw, color: colorRaw } }
}

/** A saved look from form values. An empty style means no frame; an empty filter means no filter; at least one is needed. */
export function parseLook(styleRaw: string, colorRaw: string, filterRaw: string): Check<Pick<Look, 'frame' | 'filter'>> {
  const look: Pick<Look, 'frame' | 'filter'> = {}
  if (styleRaw) {
    const frame = parseFrame(styleRaw, colorRaw)
    if (!frame.ok) return frame
    look.frame = frame.value
  }
  if (filterRaw) {
    if (!isFilterId(filterRaw)) return { ok: false, error: 'Choose a filter.' }
    look.filter = filterRaw
  }
  if (!look.frame && !look.filter) return { ok: false, error: 'Choose a frame, a filter, or both.' }
  return { ok: true, value: look }
}
