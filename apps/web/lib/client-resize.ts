// Browser-side downscaling for the avatar uploader. Dependency-free: it uses
// only createImageBitmap, canvas, and Blob APIs.
//
// This is best effort, not a guarantee. Browsers differ in what they can
// decode (HEIC, for one), in canvas memory limits on phones, and in how they
// re-encode JPEG, so the output size is not predictable. Every failure falls
// back to the original file, and the server still enforces the 1,000,000 byte
// cap, the 80px minimum, and the PNG/JPEG check. Never rely on this for safety.

export const MAX_BLOB_BYTES = 1_000_000
export const MAX_LONG_SIDE = 2048
export const MIN_SIDE = 80
export const JPEG_QUALITY_STEPS = [0.92, 0.85, 0.75] as const

/** Fit (w, h) so the long side is at most max, never upscaling. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob | null>((res) => c.toBlob(res, type, q))

export type PrepareResult = { file: File; error?: undefined } | { file?: undefined; error: string }

/**
 * Returns a file to upload. Rejects images under MIN_SIDE. Leaves small,
 * already-fitting files untouched; otherwise downscales to at most
 * MAX_LONG_SIDE and re-encodes. A PNG stays PNG if it fits, else becomes JPEG
 * at quality 0.92, 0.85, then 0.75 (the smallest result is returned if none fit).
 */
export async function prepareImage(file: File): Promise<PrepareResult> {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') return { file }
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return { file } // undecodable here; let the server decide
  }
  try {
    if (Math.min(bmp.width, bmp.height) < MIN_SIDE) {
      return { error: `The image is smaller than ${MIN_SIDE} by ${MIN_SIDE} pixels. Choose a larger image.` }
    }
    const { width, height } = fitWithin(bmp.width, bmp.height, MAX_LONG_SIDE)
    const resized = width !== bmp.width || height !== bmp.height
    if (!resized && file.size <= MAX_BLOB_BYTES) return { file }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return { file }
    ctx.drawImage(bmp, 0, 0, width, height)

    const base = file.name.replace(/\.[^.]+$/, '')
    if (file.type === 'image/png') {
      const png = await toBlob(canvas, 'image/png')
      if (png && png.size <= MAX_BLOB_BYTES) return { file: new File([png], `${base}.png`, { type: 'image/png' }) }
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
    if (!best) return { file }
    return { file: new File([best], `${base}.jpg`, { type: 'image/jpeg' }) }
  } finally {
    bmp.close()
  }
}
