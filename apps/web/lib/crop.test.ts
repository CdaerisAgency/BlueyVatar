import { describe, expect, it } from 'vitest'
import { centerCrop, clampCrop, coversImage, dragDelta, isSquare, maxZoom, meetsMinimum, moveCrop, zoomCrop, zoomOf } from './crop'

describe('centerCrop', () => {
  it('centers a portrait image on the long side', () => {
    expect(centerCrop(1000, 1500)).toEqual({ x: 0, y: 250, size: 1000 })
  })
  it('centers a landscape image', () => {
    expect(centerCrop(1600, 900)).toEqual({ x: 350, y: 0, size: 900 })
  })
  it('floors an odd difference', () => {
    expect(centerCrop(101, 200)).toEqual({ x: 0, y: 49, size: 101 })
  })
  it('is the whole image when square', () => {
    const r = centerCrop(500, 500)
    expect(r).toEqual({ x: 0, y: 0, size: 500 })
    expect(coversImage(r, 500, 500)).toBe(true)
    expect(isSquare(500, 500)).toBe(true)
    expect(isSquare(500, 501)).toBe(false)
  })
})

describe('zoomCrop', () => {
  it('halves the size at zoom 2 around the same center', () => {
    const r = zoomCrop(centerCrop(1000, 1500), 2, 1000, 1500)
    expect(r).toEqual({ x: 250, y: 500, size: 500 })
    expect(zoomOf(r, 1000, 1500)).toBe(2)
  })
  it('never zooms out past the short side', () => {
    expect(zoomCrop({ x: 0, y: 250, size: 1000 }, 0.5, 1000, 1500).size).toBe(1000)
  })
  it('stops at the minimum side', () => {
    const r = zoomCrop(centerCrop(1000, 1500), 1000, 1000, 1500)
    expect(r.size).toBe(80)
    expect(meetsMinimum(r)).toBe(true)
    expect(maxZoom(1000, 1500)).toBe(12.5)
  })
  it('keeps the crop inside the image when the center is near an edge', () => {
    const r = zoomCrop({ x: 0, y: 0, size: 1000 }, 4, 1000, 1500)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.y + r.size).toBeLessThanOrEqual(1500)
  })
  it('does not zoom an image whose short side is under the minimum', () => {
    expect(maxZoom(60, 200)).toBe(1)
  })
})

describe('moveCrop and clampCrop', () => {
  it('moves within bounds', () => {
    expect(moveCrop({ x: 0, y: 250, size: 1000 }, 0, 100, 1000, 1500)).toEqual({ x: 0, y: 350, size: 1000 })
  })
  it('stops at the edges', () => {
    expect(moveCrop({ x: 0, y: 250, size: 1000 }, -50, 9999, 1000, 1500)).toEqual({ x: 0, y: 500, size: 1000 })
    expect(moveCrop({ x: 0, y: 250, size: 1000 }, 0, -9999, 1000, 1500).y).toBe(0)
  })
  it('clamps an oversized or out-of-range rect', () => {
    expect(clampCrop({ x: -10, y: 2000, size: 5000 }, 800, 600)).toEqual({ x: 0, y: 0, size: 600 })
  })
})

describe('meetsMinimum and dragDelta', () => {
  it('flags a crop under 80 pixels', () => {
    expect(meetsMinimum({ x: 0, y: 0, size: 79 })).toBe(false)
    expect(meetsMinimum({ x: 0, y: 0, size: 80 })).toBe(true)
  })
  it('moves the region opposite to the drag, scaled to source pixels', () => {
    expect(dragDelta(10, -20, 320, { x: 0, y: 0, size: 640 })).toEqual({ dx: -20, dy: 40 })
  })
})
