import sharp from 'sharp'
import { BusyError, limitConcurrency, resizeLimitsFromEnv } from '@blueyvatar/core'
import { MAX_BLOB_BYTES, MAX_BLOB_MESSAGE, MAX_LONG_EDGE, validateImageBytes, type Check, type ImageMime } from './records'

/**
 * Server fallback for uploads that skipped the browser downscale (API or direct uploads, the Gravatar
 * import path, or a browser that could not decode the file). An image above MAX_LONG_EDGE is shrunk to
 * it with the full frame kept, and re-encoded under the byte cap. The caller still rejects above the
 * byte cap (validateImageBytes). Issue #203.
 *
 * Shares the delivery resize limiter (packages/core concurrency.ts, issue #198) and its IMG_* env
 * settings, with a smaller default because this runs inside the web process. Pixel count is capped
 * so a small file cannot decode into an enormous bitmap.
 */

sharp.cache(false)
sharp.concurrency(1)

export const MAX_INPUT_PIXELS = 48_000_000
export const BUSY_MESSAGE = 'Image processing is busy right now. Try again in a few seconds.'
const JPEG_QUALITY_STEPS = [90, 82, 74] as const
/** Extra shrink steps when quality alone does not get under the byte cap. */
const SHRINK_STEPS = [0.85, 0.7, 0.55, 0.4] as const

export type Prepared = { bytes: Uint8Array; mime: ImageMime }

const fits = (b: Buffer) => b.byteLength <= MAX_BLOB_BYTES

async function encode(bytes: Uint8Array, mime: ImageMime, edge: number): Promise<Prepared> {
  const base = () =>
    sharp(Buffer.from(bytes), { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'warning' })
      .rotate() // bakes in the EXIF orientation, which the crop is measured in
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
  if (mime === 'image/png') {
    const png = await base().png({ compressionLevel: 9 }).toBuffer()
    if (fits(png)) return { bytes: new Uint8Array(png), mime }
  }
  // JPEG has no alpha: flatten transparent pixels onto white first.
  let last: Buffer | null = null
  for (const quality of JPEG_QUALITY_STEPS) {
    last = await base().flatten({ background: '#fff' }).jpeg({ quality, mozjpeg: true }).toBuffer()
    if (fits(last)) return { bytes: new Uint8Array(last), mime: 'image/jpeg' }
  }
  return { bytes: new Uint8Array(last!), mime: 'image/jpeg' }
}

async function downscale(bytes: Uint8Array, mime: ImageMime, long: number): Promise<Prepared> {
  let out = await encode(bytes, mime, Math.min(long, MAX_LONG_EDGE))
  for (const f of SHRINK_STEPS) {
    if (out.bytes.byteLength <= MAX_BLOB_BYTES) break
    out = await encode(bytes, mime, Math.round(Math.min(long, MAX_LONG_EDGE) * f))
  }
  return out
}

const limitedDownscale = limitConcurrency(
  downscale,
  // Smaller default than delivery: one resize at a time inside the web process.
  resizeLimitsFromEnv(process.env, { maxConcurrent: 1, maxQueue: 4, queueWaitMs: 5000 }),
)

/**
 * Validates an upload and downscales it when its long edge is above MAX_LONG_EDGE. Rejects only above
 * the byte cap, below the 80 pixel minimum, or when the bytes are not a readable PNG or JPEG.
 */
export async function prepareUpload(bytes: Uint8Array): Promise<Check<Prepared>> {
  const img = validateImageBytes(bytes)
  if (!img.ok) return img
  const { mime, width, height } = img.value
  const long = Math.max(width, height)
  if (long <= MAX_LONG_EDGE) return { ok: true, value: { bytes, mime } }
  try {
    const out = await limitedDownscale(bytes, mime, long)
    if (out.bytes.byteLength > MAX_BLOB_BYTES) return { ok: false, error: MAX_BLOB_MESSAGE }
    return { ok: true, value: out }
  } catch (err) {
    if (err instanceof BusyError) return { ok: false, error: BUSY_MESSAGE }
    return { ok: false, error: 'The image could not be resized. Choose a smaller PNG or JPEG.' }
  }
}
