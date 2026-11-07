/**
 * Runs in a separate, resource-limited child process (spec section 7 and the
 * atproto blob spec's sandboxing advice). Reads one job from IPC, replies once,
 * and exits. The parent kills it on timeout.
 */
import sharp from 'sharp'

interface Job {
  input: string // base64
  size: number
  format: 'png' | 'jpeg' | 'webp'
  quality: number
}

/** Smallest accepted source edge in pixels (spec section 5). Vector sources (SVG) are exempt. */
const MIN_SOURCE_PX = 80

sharp.cache(false)
sharp.concurrency(1)

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
    // Deterministic center crop to a square (spec section 5), not content-aware.
    const img = src.rotate().resize(job.size, job.size, { fit: 'cover', position: 'centre' })
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
