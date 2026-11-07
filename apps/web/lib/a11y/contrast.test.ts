import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** WCAG 2.2 AA contrast checks for the monarch palette in tokens.css. */
const css = readFileSync(new URL('../../app/tokens.css', import.meta.url), 'utf8')

function token(name: string): string {
  const m = css.match(new RegExp(`--color-bv-${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`missing token bv-${name}`)
  return m[1]!
}

function channel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

export function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Foreground, background, minimum ratio, and where the pair is used. */
const pairs: Array<[string, string, number, string]> = [
  ['black', 'cream', 4.5, 'body text'],
  ['black', 'white', 4.5, 'card and input text'],
  ['black', 'orange', 4.5, 'primary button text'],
  ['ink-2', 'cream', 4.5, 'body copy on cream'],
  ['ink-2', 'white', 4.5, 'body copy in cards'],
  ['ink-3', 'cream', 4.5, 'captions and footer'],
  ['ink-3', 'white', 4.5, 'placeholder text and captions in cards'],
  ['orange-deep', 'cream', 4.5, 'links on cream'],
  ['orange-deep', 'white', 4.5, 'links in cards'],
  ['blue', 'cream', 4.5, 'link hover on cream'],
  ['blue', 'white', 4.5, 'link hover in cards'],
  ['code-muted', 'code-bg', 4.5, 'code comments in the dark band'],
  ['cream', 'black', 4.5, 'text in the developer band'],
  ['black', 'cream', 3, 'focus ring against the page'],
  ['black', 'white', 3, 'focus ring against cards'],
  ['black', 'orange', 3, 'focus ring and input border against the primary button'],
]

describe('monarch palette contrast (WCAG 2.2 AA)', () => {
  for (const [fg, bg, min, use] of pairs) {
    it(`${fg} on ${bg} is at least ${min}:1 (${use})`, () => {
      expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(min)
    })
  }

  it('hovercard inline colors match tokens that pass', () => {
    // The hovercard package hard-codes #6b6660 and #b4400e on white.
    expect(ratio('#6b6660', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ratio('#b4400e', '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
})
