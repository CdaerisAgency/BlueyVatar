// Browser-side downscaling for the avatar uploader. Dependency-free: it uses
// only createImageBitmap, canvas, and Blob APIs.
//
// The full original is kept (issue #203): nothing is cropped here. The crop box only produces crop
// parameters that go into the record (lib/crop.ts). An image whose long edge is at most
// MAX_LONG_SIDE is re-drawn at full size, a larger one is shrunk to MAX_LONG_SIDE with the whole frame,
// and both are re-encoded under the cap. Re-encoding through a canvas drops all metadata (EXIF GPS,
// camera serial, XMP, IPTC) and bakes in the orientation. The server strips again (issue #206).
//
// This is best effort, not a guarantee. Browsers differ in what they can
// decode (HEIC, for one), in canvas memory limits on phones, and in how they
// re-encode JPEG, so the output size is not predictable. Every failure falls
// back to the original file, and the server still enforces the byte cap, the
// 80px minimum, the PNG/JPEG check, and downscales above MAX_LONG_SIDE itself.
// Never rely on this for safety.

import { MAX_BLOB_BYTES, MAX_LONG_EDGE } from './upload-limits'

export { MAX_BLOB_BYTES }
export const MAX_LONG_SIDE = MAX_LONG_EDGE
export const MIN_SIDE = 80
export const TOO_SMALL_MESSAGE = `The image is smaller than ${MIN_SIDE} by ${MIN_SIDE} pixels. Choose a larger image.`
export const JPEG_QUALITY_STEPS = [0.92, 0.85, 0.75] as const
/** Extra shrink factors tried when quality alone does not get under the cap. */
export const SHRINK_STEPS = [0.85, 0.7, 0.55, 0.4] as const

/** Fit (w, h) so the long side is at most max, never upscaling. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob | null>((res) => c.toBlob(res, type, q))

/** Decodes with EXIF orientation applied, so crop coordinates match what the user sees. Null when this browser cannot decode the file. */
export async function decodeImage(file: File): Promise<ImageBitmap | null> {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') return null
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return null
  }
}

export type PrepareResult = { file: File; error?: undefined } | { file?: undefined; error: string }

/** Renders the whole frame at the given size and encodes it under the cap. Returns the smallest result when none fit, and null when the canvas is unavailable. */
async function render(bmp: ImageBitmap, file: File, width: number, height: number): Promise<File | null> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, width, height)
  const base = file.name.replace(/\.[^.]+$/, '')
  if (file.type === 'image/png') {
    const png = await toBlob(canvas, 'image/png')
    if (png && png.size <= MAX_BLOB_BYTES) return new File([png], `${base}.png`, { type: 'image/png' })
  }
  // JPEG has no alpha: paint transparent pixels over white first.
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  let best: Blob | null = null
  for (const q of JPEG_QUALITY_STEPS) {
    const jpg = await toBlob(canvas, 'image/jpeg', q)
    if (!jpg) continue
    if (!best || jpg.size < best.size) best = jpg
    if (jpg.size <= MAX_BLOB_BYTES) break
  }
  return best ? new File([best], `${base}.jpg`, { type: 'image/jpeg' }) : null
}

/**
 * Returns the file to upload. Rejects images under MIN_SIDE. The whole frame is drawn at full size, or
 * downscaled to at most MAX_LONG_SIDE, and always re-encoded so metadata is dropped; a PNG stays PNG if it fits, else becomes JPEG at quality 0.92, 0.85, then 0.75, and
 * if that is still over the cap the image is shrunk further in a few steps. The smallest result is
 * returned if none fit, and the server decides.
 */
export async function prepareImage(file: File, decoded?: ImageBitmap): Promise<PrepareResult> {
  const bmp = decoded ?? (await decodeImage(file))
  if (!bmp) return { file } // undecodable here; let the server decide
  try {
    if (Math.min(bmp.width, bmp.height) < MIN_SIDE) return { error: TOO_SMALL_MESSAGE }
    const first = fitWithin(bmp.width, bmp.height, MAX_LONG_SIDE)

    let out = await render(bmp, file, first.width, first.height)
    for (const f of SHRINK_STEPS) {
      if (!out || out.size <= MAX_BLOB_BYTES) break
      const { width, height } = fitWithin(bmp.width, bmp.height, Math.round(MAX_LONG_SIDE * f))
      if (Math.min(width, height) < MIN_SIDE) break
      out = (await render(bmp, file, width, height)) ?? out
    }
    return { file: out ?? file }
  } finally {
    if (!decoded) bmp.close()
  }
}
