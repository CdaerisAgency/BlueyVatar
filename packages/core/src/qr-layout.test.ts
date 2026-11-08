import { describe, expect, it } from 'vitest'
import { CENTER_AREA_FRACTION, QR_H_RECOVERY, QR_MAX_PIXELS, QR_MIN_MODULE_PX, QrOptionError, plateModules, qrLayout, qrSvgForLayout } from './qr-layout.js'

const url = (n: number) => 'https://blueyvatar.com/p/' + 'a'.repeat(n) + '.test'

describe('qrLayout', () => {
  it('derives modules from the version and uses whole pixels per module', () => {
    for (const len of [3, 20, 60, 120, 200]) {
      for (const size of [1, 100, 256, 512, 1024, 5000]) {
        const l = qrLayout(url(len), { size })
        expect(l.modules).toBe(17 + 4 * l.version)
        expect(l.totalModules).toBe(l.modules + 8)
        expect(l.pixels).toBe(l.modulePx * l.totalModules)
        expect(l.modulePx).toBeGreaterThanOrEqual(QR_MIN_MODULE_PX)
        if (size <= QR_MAX_PIXELS && size >= l.totalModules * QR_MIN_MODULE_PX) expect(l.pixels).toBeLessThanOrEqual(size)
        expect(l.pixels).toBeLessThanOrEqual(QR_MAX_PIXELS)
      }
    }
  })
  it('uses level H only with a center image', () => {
    expect(qrLayout(url(10), { size: 400 }).ecc).toBe('M')
    expect(qrLayout(url(10), { size: 400, center: true }).ecc).toBe('H')
  })
  it('keeps the plate centered, odd, and well under what level H can restore', () => {
    for (const len of [3, 20, 60, 120, 200]) {
      const l = qrLayout(url(len), { size: 800, center: true })
      const p = l.plate!
      expect(p.size % 2).toBe(1)
      expect(p.x - l.quiet).toBe(l.modules - (p.x - l.quiet) - p.size)
      expect(l.plateShare).toBeLessThanOrEqual(CENTER_AREA_FRACTION)
      expect(l.plateShare).toBeLessThan(QR_H_RECOVERY)
      expect(plateModules(l.modules)).toBe(p.size)
    }
  })
  it('validates the quiet zone', () => {
    expect(() => qrLayout(url(5), { size: 300, quiet: 3 })).toThrow(QrOptionError)
    expect(() => qrLayout(url(5), { size: 300, quiet: 17 })).toThrow(QrOptionError)
    expect(qrLayout(url(5), { size: 300, quiet: 8 }).quiet).toBe(8)
  })
  it('rejects text that does not fit in a QR code', () => {
    expect(() => qrLayout('x'.repeat(5000), { size: 2048 })).toThrow(QrOptionError)
  })
})

describe('qrSvgForLayout', () => {
  it('only accepts PNG or JPEG data URIs for the center image', () => {
    const l = qrLayout(url(5), { size: 400, center: true })
    expect(() => qrSvgForLayout(url(5), l, { dataUri: 'https://evil.test/a.png', shape: 'circle' })).toThrow(QrOptionError)
    expect(() => qrSvgForLayout(url(5), l, { dataUri: 'data:image/svg+xml;base64,AAAA', shape: 'circle' })).toThrow(QrOptionError)
    expect(qrSvgForLayout(url(5), l, { dataUri: 'data:image/png;base64,AAAA', shape: 'round' })).toContain('<image')
  })
  it('sizes the svg to the layout', () => {
    const l = qrLayout(url(5), { size: 400 })
    expect(qrSvgForLayout(url(5), l)).toContain(`width="${l.pixels}" height="${l.pixels}"`)
  })
})
