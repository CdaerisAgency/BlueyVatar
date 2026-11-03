import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { defaultSvg } from './defaults.js'

const STYLES = ['identicon', 'monsterid', 'wavatar', 'retro', 'robohash', 'pagan'] as const
const SEEDS = ['alice.test', 'bob.test', 'did:plc:abc123', 'a'.repeat(64)]

describe('default styles', () => {
  for (const style of STYLES) {
    it(`${style} is deterministic, seed-dependent, and valid SVG`, async () => {
      const svg = defaultSvg(style, SEEDS[0]!)
      expect(defaultSvg(style, SEEDS[0]!)).toBe(svg)
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 100 100">/)
      expect(svg.endsWith('</svg>')).toBe(true)
      expect(new Set(SEEDS.map((s) => defaultSvg(style, s))).size).toBe(SEEDS.length)
      const png = await sharp(Buffer.from(svg)).resize(64).png().toBuffer()
      expect(png.length).toBeGreaterThan(100)
    })
  }

  it('each style looks different for the same seed', () => {
    const all = [...STYLES, 'mp' as const].map((s) => defaultSvg(s, 'alice.test'))
    expect(new Set(all).size).toBe(all.length)
  })

  it('initials uses real initials and falls back to the silhouette', () => {
    expect(defaultSvg('initials', 'alice.test', 'al')).toContain('>AL</text>')
    const hashSeed = 'f'.repeat(64)
    expect(defaultSvg('initials', hashSeed)).toBe(defaultSvg('mp', hashSeed))
    expect(defaultSvg('initials', hashSeed, '--')).toBe(defaultSvg('mp', hashSeed))
  })
})
