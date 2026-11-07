import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { MAX_BLOB_BYTES, MAX_LONG_EDGE } from './records'
import { prepareUpload } from './server-resize'

// A noisy image compresses badly, so a large one exceeds the byte cap and forces the re-encode path.
async function noisy(width: number, height: number, format: 'png' | 'jpeg' = 'jpeg'): Promise<Uint8Array> {
  const raw = randomBytes(width * height * 3)
  const img = sharp(raw, { raw: { width, height, channels: 3 } })
  return new Uint8Array(await (format === 'png' ? img.png({ compressionLevel: 1 }) : img.jpeg({ quality: 95 })).toBuffer())
}
async function flat(width: number, height: number, format: 'png' | 'jpeg' = 'png', orientation?: number): Promise<Uint8Array> {
  let img = sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 220 } } })
  if (orientation) img = img.withMetadata({ orientation })
  return new Uint8Array(await (format === 'png' ? img.png() : img.jpeg()).toBuffer())
}

describe('prepareUpload', () => {
  it('passes an image within 4096 pixels through untouched, byte for byte', async () => {
    const bytes = await flat(4096, 3000)
    const r = await prepareUpload(bytes)
    expect(r).toMatchObject({ ok: true, value: { mime: 'image/png' } })
    expect(r.ok && r.value.bytes).toBe(bytes)
  })

  it('downscales a PNG above 4096 pixels to a 4096 long edge, full frame, same aspect ratio', async () => {
    const r = await prepareUpload(await flat(6000, 3000))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const meta = await sharp(Buffer.from(r.value.bytes)).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', MAX_LONG_EDGE, 2048])
    expect(r.value.mime).toBe('image/png')
  }, 30_000)

  it('downscales a tall JPEG on its long edge and keeps it a JPEG', async () => {
    const r = await prepareUpload(await flat(2000, 8192, 'jpeg'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const meta = await sharp(Buffer.from(r.value.bytes)).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1000, MAX_LONG_EDGE])
  }, 30_000)

  it('applies the EXIF orientation when it downscales, so a crop measured on the displayed image still lines up', async () => {
    // 5000x1000 stored, orientation 6 displays it as 1000x5000. Downscaled, it must come out 819x4096 upright.
    const r = await prepareUpload(await flat(5000, 1000, 'jpeg', 6))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const meta = await sharp(Buffer.from(r.value.bytes)).metadata()
    expect([meta.width, meta.height]).toEqual([819, MAX_LONG_EDGE])
    expect(meta.orientation ?? 1).toBe(1)
  }, 30_000)

  it('keeps a hard-to-compress PNG a PNG when it still fits the cap after downscaling', async () => {
    const src = await noisy(4300, 300, 'png')
    expect(src.byteLength).toBeLessThanOrEqual(MAX_BLOB_BYTES)
    const r = await prepareUpload(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.mime).toBe('image/png')
    const meta = await sharp(Buffer.from(r.value.bytes)).metadata()
    expect([meta.width, meta.height]).toEqual([MAX_LONG_EDGE, 286])
    expect(r.value.bytes.byteLength).toBeLessThanOrEqual(MAX_BLOB_BYTES)
  }, 60_000)

  it('rejects only above the byte cap, with a clear error, and never decodes an oversize body', async () => {
    const r = await prepareUpload(new Uint8Array(MAX_BLOB_BYTES + 1).fill(0))
    expect(r).toEqual({ ok: false, error: expect.stringContaining('5 MB') })
  })

  it('still enforces the 80 pixel minimum and the PNG or JPEG check', async () => {
    expect(await prepareUpload(await flat(79, 5000))).toMatchObject({ ok: false, error: expect.stringContaining('80 by 80') })
    expect(await prepareUpload(new TextEncoder().encode('GIF89a......'))).toMatchObject({ ok: false })
  })

  it('answers an unreadable body that claims a huge size with a plain error', async () => {
    // A PNG header that claims 50000x50000 but has no data: sharp refuses it.
    const b = new Uint8Array(40)
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    const v = new DataView(b.buffer)
    v.setUint32(16, 50000)
    v.setUint32(20, 50000)
    expect(await prepareUpload(b)).toEqual({ ok: false, error: 'The image could not be resized. Choose a smaller PNG or JPEG.' })
  })
})
