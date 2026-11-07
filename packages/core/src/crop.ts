/**
 * Crop parameters on a com.blueyvatar.image record (issue #203, spec section 5).
 *
 * The record keeps the full original and says which square of it to show. Atproto records cannot hold
 * floats, so each value is an integer in units of 1/10000 (CROP_SCALE) of the image:
 *
 * - `x` is the left edge as a fraction of the width.
 * - `y` is the top edge as a fraction of the height.
 * - `size` is the side of the square as a fraction of the short side.
 *
 * Fractions of the same image, so they stay valid when a copy is downscaled. Orientation is the
 * displayed orientation (EXIF applied), which is what a browser decodes. Pure functions, no
 * dependencies, so the browser, the web server, the indexer, and the delivery worker share them.
 */

export const CROP_SCALE = 10_000

export interface CropParams { x: number; y: number; size: number }
/** A square region in whole source pixels. */
export interface PixelCrop { left: number; top: number; size: number }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** Normalizes a square region given in source pixels. */
export function cropFromRect(rect: { x: number; y: number; size: number }, width: number, height: number): CropParams {
  const short = Math.min(width, height)
  return {
    x: clamp(Math.round((rect.x / width) * CROP_SCALE), 0, CROP_SCALE),
    y: clamp(Math.round((rect.y / height) * CROP_SCALE), 0, CROP_SCALE),
    size: clamp(Math.round((rect.size / short) * CROP_SCALE), 1, CROP_SCALE),
  }
}

/** Reads a record's `crop` value. Null (so the center crop applies) unless all three fields are integers in range. */
export function parseCrop(value: unknown): CropParams | null {
  if (value === null || typeof value !== 'object') return null
  const { x, y, size } = value as Record<string, unknown>
  const ok = (n: unknown, min: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= CROP_SCALE
  return ok(x, 0) && ok(y, 0) && ok(size, 1) ? { x, y, size } : null
}

/** The region in pixels of a width by height image, kept inside the image whatever the parameters say. */
export function pixelCrop(crop: CropParams, width: number, height: number): PixelCrop {
  const short = Math.min(width, height)
  const size = clamp(Math.round((crop.size / CROP_SCALE) * short), 1, short)
  return {
    size,
    left: clamp(Math.round((crop.x / CROP_SCALE) * width), 0, width - size),
    top: clamp(Math.round((crop.y / CROP_SCALE) * height), 0, height - size),
  }
}

/** The default crop delivery applies when a record has none: the short side, centered. */
export function centerPixelCrop(width: number, height: number): PixelCrop {
  const size = Math.min(width, height)
  return { size, left: Math.floor((width - size) / 2), top: Math.floor((height - size) / 2) }
}
