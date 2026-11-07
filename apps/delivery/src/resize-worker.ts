/**
 * Runs in a separate, resource-limited child process (spec section 7 and the
 * atproto blob spec's sandboxing advice). Reads one job from IPC, replies once,
 * and exits. The parent kills it on timeout.
 */
import sharp from 'sharp'
import { pixelCrop, type CropParams } from '@blueyvatar/core/crop'

interface Job {
  input: string // base64
  size: number
  format: 'png' | 'jpeg' | 'webp'
  quality: number
  /** Square region of the original, as fractions of it (spec section 5). Absent means the center crop. */
  crop?: CropParams
}

/** Smallest accepted source edge in pixels (spec section 5). Vector sources (SVG) are exempt. */
const MIN_SOURCE_PX = 80

sharp.cache(false)
// Threads per worker. The parent caps concurrent workers (IMG_MAX_CONCURRENT), so total threads = cap x this.
sharp.concurrency(Math.max(1, Number(process.env.BV_SHARP_THREADS) || 1))

process.once('message', async (job: Job) => {
  try {
    const src = sharp(Buffer.from(job.input, 'base64'), {
      limitInputPixels: 40_000_000,
      failOn: 'warning', // sharp docs: use 'warning' with untrusted input
    })
    const meta = await src.metadata()
    if (meta.format !== 'svg' && Math.min(meta.width ?? 0, meta.height ?? 0) < MIN_SOURCE_PX) {
      throw new Error(`invalid image: source is smaller than ${MIN_SOURCE_PX}px on a side`)
    }
    // The record's crop (spec section 5) is in displayed orientation, so rotate first and measure the rotated
    // image. Without one, a deterministic center crop to a square, not content-aware.
    let img = src.rotate()
    if (job.crop) {
      const swap = (meta.orientation ?? 1) >= 5
      const w = (swap ? meta.height : meta.width) ?? 0
      const h = (swap ? meta.width : meta.height) ?? 0
      const r = pixelCrop(job.crop, w, h)
      img = img.extract({ left: r.left, top: r.top, width: r.size, height: r.size })
    }
    img = img.resize(job.size, job.size, { fit: 'cover', position: 'centre' })
    const out =
      job.format === 'png' ? img.png({ compressionLevel: 9 })
        : job.format === 'jpeg' ? img.jpeg({ quality: job.quality, mozjpeg: true })
          : img.webp({ quality: job.quality })
    const buf = await out.withMetadata({}).toBuffer()
    process.send?.({ ok: true, output: buf.toString('base64') }, () => process.exit(0))
  } catch (err) {
    process.send?.({ ok: false, error: String(err) }, () => process.exit(1))
  }
})
