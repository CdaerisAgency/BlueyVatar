import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_BLOB_BYTES, MAX_LONG_SIDE, fitWithin, prepareImage } from './client-resize'

// A fake canvas: toBlob answers with a size that depends on the pixel count and JPEG quality, so the
// size loop and the downscale can be exercised without a browser.
function stubBrowser(sizeOf: (w: number, h: number, type: string, q?: number) => number) {
  const draws: Array<{ sw: number; sh: number; dw: number; dh: number }> = []
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: (_b: unknown, _sx: number, _sy: number, sw: number, sh: number, _dx: number, _dy: number, dw: number, dh: number) => draws.push({ sw, sh, dw, dh }),
          fillRect: () => {},
        }),
        toBlob: (cb: (b: Blob | null) => void, type: string, q?: number) => cb(new Blob([new Uint8Array(sizeOf(canvas.width, canvas.height, type, q))], { type })),
      }
      return canvas
    },
  })
  return draws
}
const bitmap = (width: number, height: number) => ({ width, height, close: () => {} }) as unknown as ImageBitmap
const file = (size: number, type = 'image/png', name = 'photo.png') => new File([new Uint8Array(size)], name, { type })

afterEach(() => vi.unstubAllGlobals())

describe('fitWithin', () => {
  it('fits the long side, keeps the aspect ratio, and never upscales', () => {
    expect(fitWithin(8000, 4000, 4096)).toEqual({ width: 4096, height: 2048 })
    expect(fitWithin(3000, 6000, 4096)).toEqual({ width: 2048, height: 4096 })
    expect(fitWithin(300, 200, 4096)).toEqual({ width: 300, height: 200 })
  })
})

describe('prepareImage (full original, no crop)', () => {
  it('uses a 4096 long edge', () => {
    expect(MAX_LONG_SIDE).toBe(4096)
    expect(MAX_BLOB_BYTES).toBe(5 * 1024 * 1024)
  })

  it('re-encodes an image within 4096 pixels at full size so metadata is dropped, even when it is not square', async () => {
    const draws = stubBrowser(() => 100_000)
    const f = file(3_000_000)
    const r = await prepareImage(f, bitmap(4096, 2000))
    expect(r.file).not.toBe(f)
    expect(draws[0]).toEqual({ sw: 4096, sh: 2000, dw: 4096, dh: 2000 })
  })

  it('downscales an image above 4096 pixels with the whole frame and the same aspect ratio', async () => {
    const draws = stubBrowser(() => 100_000)
    const r = await prepareImage(file(900_000), bitmap(8000, 4000))
    expect(r.error).toBeUndefined()
    expect(r.file?.type).toBe('image/png')
    // The source rectangle is the entire bitmap: nothing is cropped.
    expect(draws[0]).toEqual({ sw: 8000, sh: 4000, dw: 4096, dh: 2048 })
  })

  it('does not crop a portrait image either', async () => {
    const draws = stubBrowser(() => 100_000)
    await prepareImage(file(900_000), bitmap(3000, 6000))
    expect(draws[0]).toEqual({ sw: 3000, sh: 6000, dw: 2048, dh: 4096 })
  })

  it('re-encodes a PNG that is too big as a JPEG, stepping quality down until it fits', async () => {
    stubBrowser((_w, _h, type, q) => (type === 'image/png' ? MAX_BLOB_BYTES + 1 : q! >= 0.9 ? MAX_BLOB_BYTES + 1 : q! >= 0.8 ? MAX_BLOB_BYTES - 1 : 10))
    const r = await prepareImage(file(MAX_BLOB_BYTES + 100), bitmap(3000, 2000))
    expect(r.file?.type).toBe('image/jpeg')
    expect(r.file?.name).toBe('photo.jpg')
    expect(r.file?.size).toBe(MAX_BLOB_BYTES - 1) // the 0.85 step
  })

  it('shrinks further when even the lowest JPEG quality is over the cap', async () => {
    const draws = stubBrowser((w, h, type) => (type === 'image/png' ? MAX_BLOB_BYTES + 1 : Math.round(w * h * 0.8)))
    const r = await prepareImage(file(MAX_BLOB_BYTES + 100), bitmap(4000, 3000))
    expect(r.file?.size).toBeLessThanOrEqual(MAX_BLOB_BYTES)
    const last = draws.at(-1)!
    expect(last.dw).toBeLessThan(4000)
    expect(last.dw / last.dh).toBeCloseTo(4 / 3, 2)
    expect([last.sw, last.sh]).toEqual([4000, 3000])
  })

  it('rejects an image under 80 pixels and hands an undecodable file to the server', async () => {
    stubBrowser(() => 1)
    expect(await prepareImage(file(100), bitmap(60, 500))).toEqual({ error: expect.stringContaining('80 by 80') })
    vi.stubGlobal('createImageBitmap', async () => { throw new Error('no decoder') })
    const f = file(100)
    expect(await prepareImage(f)).toEqual({ file: f })
  })
})
