import { createHash } from 'node:crypto'
import type { DefaultStyle } from '@blueyvatar/core'

/**
 * Default images (spec section 7, `d` parameter). Every style is original
 * geometric art generated from the SHA256 of the seed, so output is
 * deterministic and no third-party artwork is involved.
 */

type Draw = (h: Hasher) => string

interface Hasher {
  /** Integer in [0, n) taken from hash byte i. */
  pick(i: number, n: number): number
  /** Bit k of the hash, wrapping after 256 bits. */
  bit(k: number): boolean
  hue(i: number): number
}

function hasher(seed: string): Hasher {
  const b = createHash('sha256').update(seed, 'utf8').digest()
  return {
    pick: (i, n) => b[i % 32]! % n,
    bit: (k) => ((b[(k >> 3) % 32]! >> (k & 7)) & 1) === 1,
    hue: (i) => Math.round((b[i % 32]! / 256) * 360),
  }
}

const wrap = (bg: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/>${body}</svg>`
const rect = (x: number, y: number, w: number, h: number, fill: string, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`
const circle = (cx: number, cy: number, r: number, fill: string) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`
const poly = (pts: string, fill: string) => `<polygon points="${pts}" fill="${fill}"/>`
const stroke = (d: string, color: string, w = 3) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`

/** Left-right mirrored grid; `fill` returns a color for a cell or null to skip it. */
function mirrored(rows: number, cols: number, cell: number, ox: number, oy: number, fill: (r: number, c: number, k: number) => string | null) {
  const half = Math.ceil(cols / 2)
  let out = ''
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < half; c++) {
      const color = fill(r, c, r * half + c)
      if (!color) continue
      out += rect(ox + c * cell, oy + r * cell, cell, cell, color)
      if (cols - 1 - c !== c) out += rect(ox + (cols - 1 - c) * cell, oy + r * cell, cell, cell, color)
    }
  }
  return out
}

const silhouette = () =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#c9d3dd"/><circle cx="50" cy="38" r="18" fill="#fff"/><path d="M16 92c4-20 18-30 34-30s30 10 34 30z" fill="#fff"/></svg>'

/** 5x5 mirrored blocks in one color on a light field. */
const identicon: Draw = (h) =>
  wrap('#f1f1f1', mirrored(5, 5, 16, 10, 10, (_r, _c, k) => (h.bit(k) ? `hsl(${h.hue(0)},55%,48%)` : null)))

/** 8x8 mirrored sprite in two neon colors on black, in the spirit of arcade pixel art. */
const retro: Draw = (h) =>
  wrap('#12121c', mirrored(8, 8, 10, 10, 10, (_r, _c, k) => {
    if (!h.bit(k)) return null
    return h.bit(k + 64) ? `hsl(${h.hue(1)},90%,62%)` : `hsl(${(h.hue(1) + 140) % 360},90%,62%)`
  }))

/** A round-bodied creature with horns, one to three eyes, arms, and one of three mouths. */
const monsterid: Draw = (h) => {
  const body = `hsl(${h.hue(0)},60%,55%)`
  const dark = `hsl(${h.hue(0)},60%,25%)`
  const eyes = 1 + h.pick(1, 3)
  let s = ''
  if (h.bit(10)) s += poly('26,32 30,12 42,30', dark) + poly('74,32 70,12 58,30', dark)
  else s += stroke('M38 30 L34 14 M62 30 L66 14', dark, 3) + circle(34, 14, 4, dark) + circle(66, 14, 4, dark)
  s += stroke(`M22 56 L8 ${44 + h.pick(2, 20)} M78 56 L92 ${44 + h.pick(3, 20)}`, body, 6)
  s += rect(32, 80, 10, 12, dark) + rect(58, 80, 10, 12, dark)
  s += rect(20, 26, 60, 58, body, ` rx="${10 + h.pick(4, 3) * 10}"`)
  for (let i = 0; i < eyes; i++) {
    const x = eyes === 1 ? 50 : 34 + (i * 32) / (eyes - 1)
    s += circle(x, 46, eyes === 3 ? 7 : 9, '#fff') + circle(x, 47, 3.5, '#111')
  }
  const m = h.pick(5, 3)
  s += m === 0 ? stroke('M34 66 Q50 80 66 66', dark, 3.5)
    : m === 1 ? `<polyline points="32,68 38,62 44,68 50,62 56,68 62,62 68,68" fill="none" stroke="${dark}" stroke-width="3.5" stroke-linejoin="round"/>`
    : rect(38, 64, 24, 10, dark, ' rx="3"') + rect(42, 64, 5, 4, '#fff') + rect(53, 64, 5, 4, '#fff')
  return wrap(`hsl(${(h.hue(0) + 180) % 360},45%,86%)`, s)
}

/** A friendly face: hair, eyes, brows, and mouth each chosen from a few shapes. */
const wavatar: Draw = (h) => {
  const hair = `hsl(${h.hue(2)},50%,${25 + h.pick(6, 3) * 12}%)`
  const skin = `hsl(${20 + h.pick(3, 25)},${45 + h.pick(4, 30)}%,${60 + h.pick(5, 25)}%)`
  const ink = '#2a2230'
  let s = ''
  const hv = h.pick(7, 3)
  s += hv === 0 ? `<path d="M18 56 C14 14 86 14 82 56 C70 36 30 36 18 56Z" fill="${hair}"/>`
    : hv === 1 ? circle(50, 24, 20, hair) + circle(26, 36, 12, hair) + circle(74, 36, 12, hair)
    : poly('20,52 26,12 40,28 50,8 60,28 74,12 80,52', hair)
  s += circle(50, 54, 30, skin)
  s += hv === 0 ? `<path d="M20 52 C24 22 76 22 80 52 C68 36 32 36 20 52Z" fill="${hair}"/>`
    : hv === 1 ? `<path d="M22 46 Q50 22 78 46 Q50 34 22 46Z" fill="${hair}"/>`
    : poly('22,46 30,26 50,38 70,26 78,46 50,36', hair)
  const ev = h.pick(8, 3)
  for (const x of [38, 62]) {
    s += ev === 0 ? circle(x, 52, 3.5, ink)
      : ev === 1 ? `<ellipse cx="${x}" cy="52" rx="6" ry="7" fill="#fff"/>` + circle(x, 53, 3, ink)
      : rect(x - 5, 51, 10, 3, ink, ' rx="1.5"')
  }
  if (h.bit(12)) s += stroke('M31 43 L45 41 M55 41 L69 43', ink, 2.5)
  const mv = h.pick(9, 4)
  s += mv === 0 ? stroke('M38 68 Q50 78 62 68', ink)
    : mv === 1 ? stroke('M40 70 L60 70', ink)
    : mv === 2 ? `<ellipse cx="50" cy="71" rx="8" ry="5" fill="${ink}"/>`
    : circle(50, 70, 3.5, ink)
  return wrap(`hsl(${h.hue(0)},55%,${72 + h.pick(10, 3) * 6}%)`, s)
}

/** A boxy robot: antenna, ears, visor or eyes, a grille mouth, and a chest panel. */
const robohash: Draw = (h) => {
  const metal = `hsl(${h.hue(0)},25%,${62 + h.pick(1, 3) * 6}%)`
  const shade = `hsl(${h.hue(0)},25%,35%)`
  const glow = `hsl(${h.hue(3)},90%,58%)`
  let s = ''
  s += rect(49, 6, 2, 12, shade)
  s += h.bit(0) ? circle(50, 7, 5, glow) : rect(45, 3, 10, 6, glow, ' rx="2"')
  s += rect(12, 34, 8, 16, shade) + rect(80, 34, 8, 16, shade)
  s += rect(22, 16, 56, 44, metal, ' rx="6"')
  const ev = h.pick(2, 3)
  s += ev === 0 ? rect(30, 28, 40, 10, '#1b1d28', ' rx="3"') + rect(32 + h.pick(4, 24), 30, 8, 6, glow)
    : ev === 1 ? rect(30, 28, 14, 14, '#fff') + rect(56, 28, 14, 14, '#fff') + rect(34, 32, 6, 6, '#111') + rect(60, 32, 6, 6, '#111')
    : circle(38, 35, 8, '#fff') + circle(62, 35, 8, '#fff') + circle(38, 35, 3.5, glow) + circle(62, 35, 3.5, glow)
  const mv = h.pick(5, 2)
  s += mv === 0 ? [0, 1, 2, 3, 4].map((i) => rect(34 + i * 7, 46, 3, 9, shade)).join('') : rect(34, 48, 32, 5, shade, ' rx="2"')
  s += rect(30, 62, 40, 30, metal, ' rx="4"') + rect(40, 70, 20, 12, '#1b1d28', ' rx="2"') + circle(50, 76, 3, glow)
  s += rect(18, 66, 10, 22, shade, ' rx="3"') + rect(72, 66, 10, 22, shade, ' rx="3"')
  return wrap(`hsl(${(h.hue(0) + 160) % 360},40%,88%)`, s)
}

/** A 10 by 14 pixel adventurer with one of four headgear styles. */
const pagan: Draw = (h) => {
  const u = 6, ox = 20, oy = 8
  const px = (x: number, y: number, w: number, hh: number, c: string) => rect(ox + x * u, oy + y * u, w * u, hh * u, c)
  const skin = `hsl(${22 + h.pick(0, 20)},55%,${55 + h.pick(1, 25)}%)`
  const shirt = `hsl(${h.hue(2)},60%,45%)`
  const gear = `hsl(${h.hue(3)},45%,${h.bit(4) ? 35 : 60}%)`
  const hv = h.pick(5, 4)
  let s = px(0, 7, 2, 3, skin) + px(8, 7, 2, 3, skin) + px(2, 7, 6, 4, shirt) + px(2, 11, 2, 3, '#3a3350') + px(6, 11, 2, 3, '#3a3350')
  s += px(2, 3, 6, 4, skin) + px(3, 4, 1, 1, '#111') + px(6, 4, 1, 1, '#111') + px(4, 5, 2, 1, '#8a3b3b')
  s += hv === 0 ? px(2, 1, 6, 2, gear) + px(2, 3, 6, 1, gear) + px(4, 0, 2, 1, shirt)
    : hv === 1 ? px(4, 0, 2, 1, gear) + px(3, 1, 4, 1, gear) + px(2, 2, 6, 1, gear) + px(1, 3, 8, 1, gear)
    : hv === 2 ? px(2, 2, 6, 1, gear) + px(1, 3, 1, 4, gear) + px(8, 3, 1, 4, gear)
    : px(1, 2, 8, 2, shirt) + px(1, 4, 1, 3, shirt) + px(8, 4, 1, 3, shirt)
  return wrap(`hsl(${(h.hue(2) + 180) % 360},35%,82%)`, s)
}

const DRAW: Partial<Record<DefaultStyle, Draw>> = { identicon, monsterid, wavatar, retro, robohash, pagan }

/** Uppercase letters and digits only, at most two. */
export function cleanInitials(raw: string | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2)
}

/** Initials from a display name: the first letters of its first two words, as Gravatar's `name` does. */
export function initialsFromName(raw: string | null | undefined): string {
  const words = (raw ?? '').slice(0, 100).split(/[\s._-]+/).filter(Boolean)
  return cleanInitials(words.slice(0, 2).map((w) => [...w][0]).join(''))
}

/**
 * `initials` is a handle's first letters. With none, or for a hash seed, it draws the silhouette.
 * `mp` and any unknown style also draw the silhouette.
 */
export function defaultSvg(style: DefaultStyle | 'service', seed: string, initials?: string): string {
  if (style === 'blank') return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"/>'
  if (style === 'initials') {
    const text = cleanInitials(initials)
    if (!text) return silhouette()
    const hue = [...seed].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="hsl(${hue},45%,45%)"/><text x="50" y="50" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="42" fill="#fff">${text}</text></svg>`
  }
  const draw = DRAW[style as DefaultStyle]
  return draw ? draw(hasher(seed)) : silhouette()
}
