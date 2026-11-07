/**
 * Profile background color (com.blueyvatar.profile#backgroundColor, spec section 8, phase v2).
 * Only `#rrggbb` is accepted. Text color is picked for a WCAG AA contrast ratio of 4.5 to 1.
 * packages/hovercards carries a copy of the contrast math because that embed has no imports.
 */

export const BACKGROUND_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** WCAG AA ratio for normal text. */
export const MIN_TEXT_CONTRAST = 4.5

/** Text colors tried against a custom background, in order of preference on a tie. */
export const TEXT_COLOR_CANDIDATES = ['#1a1a1a', '#ffffff'] as const

/** Lowercase `#rrggbb`, or null for anything else (names, short hex, rgb(), alpha, whitespace, non-strings). */
export function normalizeBackgroundColor(value: unknown): string | null {
  return typeof value === 'string' && BACKGROUND_COLOR_RE.test(value) ? value.toLowerCase() : null
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

/** WCAG contrast ratio between two `#rrggbb` colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The text color to use on a background, or null when the background is invalid or neither candidate
 * reaches 4.5 to 1. Callers fall back to the default palette on null.
 */
export function readableTextColor(background: unknown): string | null {
  const bg = normalizeBackgroundColor(background)
  if (!bg) return null
  let best: string | null = null
  let bestRatio = 0
  for (const t of TEXT_COLOR_CANDIDATES) {
    const r = contrastRatio(bg, t)
    if (r > bestRatio) {
      best = t
      bestRatio = r
    }
  }
  return bestRatio >= MIN_TEXT_CONTRAST ? best : null
}

/** Background and text colors for a profile, or null when the default palette applies. */
export function profileColors(background: unknown): { background: string; text: string } | null {
  const bg = normalizeBackgroundColor(background)
  const text = bg ? readableTextColor(bg) : null
  return bg && text ? { background: bg, text } : null
}
