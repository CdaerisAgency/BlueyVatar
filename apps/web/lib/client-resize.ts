// Browser-side downscaling for the avatar uploader. Dependency-free: it uses
// only createImageBitmap, canvas, and Blob APIs.
//
// This is best effort, not a guarantee. Browsers differ in what they can
// decode (HEIC, for one), in canvas memory limits on phones, and in how they
// re-encode JPEG, so the output size is not predictable. Every failure falls
// back to the original file, and the server still enforces the 1,000,000 byte
// cap, the 80px minimum, and the PNG/JPEG check. Never rely on this for safety.

import { clampCrop, coversImage, meetsMinimum, type CropRect } from './crop'

export const MAX_BLOB_BYTES = 1_000_000
export const MAX_LONG_SIDE = 2048
export const MIN_SIDE = 80
export const TOO_SMALL_MESSAGE = `The image is smaller than ${MIN_SIDE} by ${MIN_SIDE} pixels. Choose a larger image.`
export const JPEG_QUALITY_STEPS = [0.92, 0.85, 0.75] as const

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

/**
 * Returns a file to upload. Rejects images under MIN_SIDE. With a crop (a square
 * region in source pixels), renders only that region and re-encodes it, and the
 * 80 pixel minimum applies to the cropped result. Without one, leaves small,
 * already-fitting files untouched; otherwise downscales to at most
 * MAX_LONG_SIDE and re-encodes. A PNG stays PNG if it fits, else becomes JPEG
 * at quality 0.92, 0.85, then 0.75 (the smallest result is returned if none fit).
 */
export async function prepareImage(file: File, crop?: CropRect, decoded?: ImageBitmap): Promise<PrepareResult> {
  const bmp = decoded ?? (await decodeImage(file))
  if (!bmp) return { file } // undecodable here; let the server decide
  try {
    if (Math.min(bmp.width, bmp.height) < MIN_SIDE) return { error: TOO_SMALL_MESSAGE }
    const region = crop && !coversImage(crop, bmp.width, bmp.height) ? clampCrop(crop, bmp.width, bmp.height) : null
    if (region && !meetsMinimum(region, MIN_SIDE)) return { error: TOO_SMALL_MESSAGE }
    const sx = region?.x ?? 0
    const sy = region?.y ?? 0
    const sw = region?.size ?? bmp.width
    const sh = region?.size ?? bmp.height
    const { width, height } = fitWithin(sw, sh, MAX_LONG_SIDE)
    const resized = width !== sw || height !== sh
    if (!region && !resized && file.size <= MAX_BLOB_BYTES) return { file }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return { file }
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, width, height)

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
    if (!decoded) bmp.close()
  }
}
