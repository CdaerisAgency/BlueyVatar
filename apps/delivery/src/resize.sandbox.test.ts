import sharp from 'sharp'
import { qrSvg } from '../dist/qr.js'
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
