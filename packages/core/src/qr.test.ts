import { describe, expect, it } from 'vitest'
import { qrSvg } from './qr.js'

describe('qrSvg', () => {
  it('renders a square SVG with a quiet zone and the requested size', () => {
    const svg = qrSvg('https://bv.test/p/alice.test', 128)
    expect(svg).toMatch(/^<svg [^>]*width="128" height="128" viewBox="0 0 (\d+) \1"/)
    expect(svg).toContain('<path d="M')
  })

  it('is deterministic for the same input', () => {
    expect(qrSvg('x', 64)).toBe(qrSvg('x', 64))
    expect(qrSvg('x', 64)).not.toBe(qrSvg('y', 64))
  })
})
