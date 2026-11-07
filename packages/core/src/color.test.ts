import { describe, expect, it } from 'vitest'
import { contrastRatio, normalizeBackgroundColor, profileColors, readableTextColor, MIN_TEXT_CONTRAST } from './color.js'

describe('normalizeBackgroundColor', () => {
  it('accepts #rrggbb and lowercases it', () => {
    expect(normalizeBackgroundColor('#FFAA00')).toBe('#ffaa00')
    expect(normalizeBackgroundColor('#1a1a1a')).toBe('#1a1a1a')
  })
  it.each(['', 'red', '#fff', '#ffff', '#ff00ff00', 'ff00ff', '#ggggggg', '#gggggg', ' #ffffff', '#ffffff\n', 'rgb(1,2,3)', 'url(x)'])('rejects %j', (v) => {
    expect(normalizeBackgroundColor(v)).toBeNull()
  })
  it('rejects non-strings', () => {
    for (const v of [null, undefined, 123, {}, ['#ffffff']]) expect(normalizeBackgroundColor(v)).toBeNull()
  })
})

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })
  it('is symmetric', () => {
    expect(contrastRatio('#336699', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#336699'), 10)
  })
})

describe('readableTextColor', () => {
  it('uses dark text on light backgrounds and white text on dark ones', () => {
    expect(readableTextColor('#fffbf4')).toBe('#1a1a1a')
    expect(readableTextColor('#ffff00')).toBe('#1a1a1a')
    expect(readableTextColor('#1f4e9b')).toBe('#ffffff')
    expect(readableTextColor('#000000')).toBe('#ffffff')
  })
  it('returns null for invalid input', () => {
    expect(readableTextColor('blue')).toBeNull()
    expect(readableTextColor(null)).toBeNull()
  })
  it('returns null when no candidate reaches 4.5 to 1', () => {
    // Mid gray sits between the two candidates and passes with neither.
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(MIN_TEXT_CONTRAST)
    expect(contrastRatio('#777777', '#1a1a1a')).toBeLessThan(MIN_TEXT_CONTRAST)
    expect(readableTextColor('#777777')).toBeNull()
  })
  it('always returns a pair that meets AA when it returns one', () => {
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const bg = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
          const text = readableTextColor(bg)
          if (text) expect(contrastRatio(bg, text)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
        }
      }
    }
  })
})

describe('profileColors', () => {
  it('pairs the background with its text color', () => {
    expect(profileColors('#1F4E9B')).toEqual({ background: '#1f4e9b', text: '#ffffff' })
  })
  it('is null for unset, invalid, or failing colors so the default palette applies', () => {
    expect(profileColors(null)).toBeNull()
    expect(profileColors('nope')).toBeNull()
    expect(profileColors('#777777')).toBeNull()
  })
})
