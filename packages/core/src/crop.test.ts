import { describe, expect, it } from 'vitest'
import { CROP_SCALE, centerPixelCrop, cropFromRect, parseCrop, pixelCrop } from './crop.js'

describe('cropFromRect', () => {
  it('normalizes x by width, y by height, and size by the short side', () => {
    expect(cropFromRect({ x: 100, y: 300, size: 200 }, 400, 800)).toEqual({ x: 2500, y: 3750, size: 5000 })
  })
  it('keeps values inside the range', () => {
    expect(cropFromRect({ x: -5, y: 9999, size: 0 }, 400, 600)).toEqual({ x: 0, y: CROP_SCALE, size: 1 })
  })
})

describe('parseCrop', () => {
  it('accepts three integers in range', () => {
    expect(parseCrop({ x: 0, y: 10000, size: 1 })).toEqual({ x: 0, y: 10000, size: 1 })
  })
  it.each([
    [undefined], [null], ['x'], [{}], [{ x: 1, y: 2 }], [{ x: 1.5, y: 0, size: 5 }], [{ x: -1, y: 0, size: 5 }],
    [{ x: 0, y: 0, size: 0 }], [{ x: 0, y: 0, size: 10001 }], [{ x: '1', y: 0, size: 5 }], [{ x: NaN, y: 0, size: 5 }],
  ])('rejects %j so the center crop applies', (v) => expect(parseCrop(v)).toBeNull())
  it('ignores unknown extra fields', () => {
    expect(parseCrop({ x: 1, y: 2, size: 3, extra: true })).toEqual({ x: 1, y: 2, size: 3 })
  })
})

describe('pixelCrop', () => {
  it('maps the parameters onto the image it is applied to', () => {
    expect(pixelCrop({ x: 2500, y: 3750, size: 5000 }, 400, 800)).toEqual({ left: 100, top: 300, size: 200 })
  })
  it('round trips a rect within one pixel at any scale of the same image', () => {
    const rect = { x: 123, y: 457, size: 1789 }
    const p = cropFromRect(rect, 3000, 4096)
    const full = pixelCrop(p, 3000, 4096)
    expect(Math.abs(full.left - rect.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(full.top - rect.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(full.size - rect.size)).toBeLessThanOrEqual(1)
    const half = pixelCrop(p, 1500, 2048)
    expect(Math.abs(half.size - rect.size / 2)).toBeLessThanOrEqual(1)
  })
  it('clamps a region that would leave the image', () => {
    expect(pixelCrop({ x: 10000, y: 10000, size: 10000 }, 300, 500)).toEqual({ left: 0, top: 200, size: 300 })
    expect(pixelCrop({ x: 9000, y: 0, size: 5000 }, 1000, 400)).toEqual({ left: 800, top: 0, size: 200 })
  })
  it('never returns an empty region', () => {
    expect(pixelCrop({ x: 0, y: 0, size: 1 }, 80, 80).size).toBe(1)
  })
  it('the full square equals the whole short side', () => {
    expect(pixelCrop({ x: 0, y: 0, size: CROP_SCALE }, 640, 480)).toEqual({ left: 0, top: 0, size: 480 })
  })
})

describe('centerPixelCrop', () => {
  it('centers the short side', () => {
    expect(centerPixelCrop(300, 100)).toEqual({ left: 100, top: 0, size: 100 })
    expect(centerPixelCrop(400, 600)).toEqual({ left: 0, top: 100, size: 400 })
  })
})
