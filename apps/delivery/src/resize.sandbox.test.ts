import sharp from 'sharp'
import { qrSvg } from '@blueyvatar/core'
import { describe, expect, it } from 'vitest'
// The worker path resolves next to the compiled module, so this test runs the
// built output. The package test script builds dist before running vitest.
import { sandboxedResizer } from '../dist/resize.js'

async function samplePng(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 4, background: { r: 30, g: 120, b: 220, alpha: 1 } },
  }).png().toBuffer()
  return new Uint8Array(buf)
}

describe('sandboxedResizer (forked worker, built output)', () => {
  const resize = sandboxedResizer({ timeoutMs: 20_000 })

  it.each([
    ['png', 'png'],
    ['jpeg', 'jpeg'],
    ['webp', 'webp'],
  ] as const)('resizes a PNG to a square %s', async (format, expected) => {
    const out = await resize({ input: await samplePng(300, 200), size: 64, format, quality: 80 })
    const meta = await sharp(Buffer.from(out)).metadata()
    expect(meta.format).toBe(expected)
    expect([meta.width, meta.height]).toEqual([64, 64])
  }, 30_000)

  it('center-crops a non-square source instead of squashing it', async () => {
    // 300x100 image: red left third, green middle third, blue right third.
    const band = (r: number, g: number, b: number) =>
      sharp({ create: { width: 100, height: 100, channels: 3, background: { r, g, b } } }).png().toBuffer()
    const row = await sharp({ create: { width: 300, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite([
        { input: await band(255, 0, 0), left: 0, top: 0 },
        { input: await band(0, 255, 0), left: 100, top: 0 },
        { input: await band(0, 0, 255), left: 200, top: 0 },
      ])
      .png()
      .toBuffer()
    const out = await resize({ input: new Uint8Array(row), size: 80, format: 'png', quality: 80 })
    const { data, info } = await sharp(Buffer.from(out)).raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([80, 80])
    const px = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)]
    expect(px(2, 40)).toEqual([0, 255, 0])
    expect(px(77, 40)).toEqual([0, 255, 0])
  }, 30_000)

  // 300x100 image: red, green, blue thirds from left to right.
  async function thirds(orientation?: number) {
    const band = (r: number, g: number, b: number) =>
      sharp({ create: { width: 100, height: 100, channels: 3, background: { r, g, b } } }).png().toBuffer()
    let img = sharp({ create: { width: 300, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } } }).composite([
      { input: await band(255, 0, 0), left: 0, top: 0 },
      { input: await band(0, 255, 0), left: 100, top: 0 },
      { input: await band(0, 0, 255), left: 200, top: 0 },
    ])
    if (orientation) img = img.withMetadata({ orientation })
    return new Uint8Array(await img.jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer())
  }
  async function pixel(out: Uint8Array, x: number, y: number) {
    const { data, info } = await sharp(Buffer.from(out)).raw().toBuffer({ resolveWithObject: true })
    const i = (y * info.width + x) * info.channels
    return [...data.subarray(i, i + 3)].map((v) => (v > 200 ? 255 : v < 60 ? 0 : v))
  }

  it('applies the record crop before resizing instead of the center crop', async () => {
    // x 0 of 300 wide, size 10000 of the 100 short side: the left (red) square.
    const out = await resize({ input: await thirds(), size: 80, format: 'png', quality: 80, crop: { x: 0, y: 0, size: 10000 } })
    expect(await pixel(out, 40, 40)).toEqual([255, 0, 0])
    const right = await resize({ input: await thirds(), size: 80, format: 'png', quality: 80, crop: { x: 10000, y: 0, size: 10000 } })
    expect(await pixel(right, 40, 40)).toEqual([0, 0, 255])
  }, 30_000)

  it('zooms into a smaller crop region', async () => {
    // A 50 px square at the left edge of the green third (x = 100 of 300, so 3333/10000).
    const out = await resize({ input: await thirds(), size: 80, format: 'png', quality: 80, crop: { x: 3334, y: 0, size: 5000 } })
    expect(await pixel(out, 5, 5)).toEqual([0, 255, 0])
    expect(await pixel(out, 75, 75)).toEqual([0, 255, 0])
  }, 30_000)

  it('measures the crop in displayed orientation when the source has an EXIF rotation', async () => {
    // Orientation 6 displays the 300x100 file as 100x300 (rotated clockwise): red at the top, blue at the bottom.
    const input = await thirds(6)
    const top = await resize({ input, size: 80, format: 'png', quality: 80, crop: { x: 0, y: 0, size: 10000 } })
    expect(await pixel(top, 40, 40)).toEqual([255, 0, 0])
    const bottom = await resize({ input, size: 80, format: 'png', quality: 80, crop: { x: 0, y: 10000, size: 10000 } })
    expect(await pixel(bottom, 40, 40)).toEqual([0, 0, 255])
    const none = await resize({ input, size: 80, format: 'png', quality: 80 })
    expect(await pixel(none, 40, 40)).toEqual([0, 255, 0])
  }, 30_000)

  it('keeps the center crop for a source with no crop and for an out-of-range crop', async () => {
    const out = await resize({ input: await thirds(), size: 80, format: 'png', quality: 80, crop: { x: 10000, y: 10000, size: 10000 } })
    expect(await pixel(out, 40, 40)).toEqual([0, 0, 255]) // clamped inside the image, not an error
  }, 30_000)

  it('rejects a source under 80px on either side as an invalid image', async () => {
    await expect(resize({ input: await samplePng(79, 300), size: 64, format: 'png', quality: 80 })).rejects.toThrow(/invalid image/)
    await expect(resize({ input: await samplePng(300, 79), size: 64, format: 'png', quality: 80 })).rejects.toThrow(/invalid image/)
    const ok = await resize({ input: await samplePng(80, 80), size: 64, format: 'png', quality: 80 })
    expect(ok.byteLength).toBeGreaterThan(0)
  }, 30_000)

  it('rasterizes a QR code SVG to a square PNG of the requested size', async () => {
    const out = await resize({ input: new TextEncoder().encode(qrSvg('https://bv.test/p/alice.test', 200)), size: 200, format: 'png', quality: 85 })
    const meta = await sharp(Buffer.from(out)).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 200, 200])
  }, 30_000)

  it('rejects input that is not an image', async () => {
    await expect(
      resize({ input: new TextEncoder().encode('not an image'), size: 64, format: 'png', quality: 80 }),
    ).rejects.toThrow()
  }, 30_000)

  it('kills the worker when it runs past the timeout', async () => {
    const slow = sandboxedResizer({ timeoutMs: 1 })
    await expect(slow({ input: await samplePng(64, 64), size: 32, format: 'png', quality: 80 })).rejects.toThrow(/timed out/)
  }, 30_000)
})
