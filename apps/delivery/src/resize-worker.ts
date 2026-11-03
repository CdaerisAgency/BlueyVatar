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

sharp.cache(false)
sharp.concurrency(1)

process.once('message', async (job: Job) => {
  try {
    const img = sharp(Buffer.from(job.input, 'base64'), {
      limitInputPixels: 40_000_000,
      failOn: 'warning', // sharp docs: use 'warning' with untrusted input
    })
      .rotate()
      .resize(job.size, job.size, { fit: 'cover', position: 'attention' })
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
