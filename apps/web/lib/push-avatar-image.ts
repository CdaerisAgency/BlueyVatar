import sharp from 'sharp'
import { centerPixelCrop, pixelCrop, type CropParams } from '@blueyvatar/core'
import type { ImageMime } from './records'
import { MAX_INPUT_PIXELS } from './server-resize'

/** Each step keeps this share of the previous side, so every size comes from the source and none is fixed. */
const SHRINK_FACTORS = [1, 0.85, 0.7, 0.55, 0.4, 0.3] as const
const JPEG_QUALITIES = [90, 80, 70] as const

export type AvatarImage = { bytes: Uint8Array; mime: ImageMime; side: number }
export type AvatarImageResult = { ok: true; value: AvatarImage } | { ok: false; error: string }

/** The error text when no size fits. `prepareAvatar` returns it as-is, and push-profile.ts matches on it. */
export const AVATAR_TOO_LARGE = (limit: string): string => `This image is still larger than the ${limit} limit for profile pictures after shrinking it. Choose a simpler or smaller image.`

/**
 * Turns a stored avatar into what an app's profile record accepts: the square region the user chose (or the center square),
 * as a PNG when that fits and a JPEG otherwise, under `maxBytes` (the app's lexicon limit, from push-apps.ts). Metadata is dropped except the
 * color profile. The side length is derived from the source and shrunk by factors, never hardcoded.
 */
export async function prepareAvatar(source: Uint8Array, crop: CropParams | null | undefined, limit: { maxBytes: number; label: string }): Promise<AvatarImageResult> {
  try {
    const open = () => sharp(Buffer.from(source), { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'warning' }).rotate()
    const { data, info } = await open().toBuffer({ resolveWithObject: true })
    const region = crop ? pixelCrop(crop, info.width, info.height) : centerPixelCrop(info.width, info.height)
    const square = await sharp(data).extract({ left: region.left, top: region.top, width: region.size, height: region.size }).toBuffer()
    const base = (side: number) => sharp(square).keepIccProfile().resize({ width: side, height: side, fit: 'fill', withoutEnlargement: true })
    for (const f of SHRINK_FACTORS) {
      const side = Math.max(1, Math.round(region.size * f))
      const png = await base(side).png({ compressionLevel: 9 }).toBuffer()
      if (png.byteLength <= limit.maxBytes) return { ok: true, value: { bytes: new Uint8Array(png), mime: 'image/png', side } }
      for (const quality of JPEG_QUALITIES) {
        const jpg = await base(side).flatten({ background: '#fff' }).jpeg({ quality, mozjpeg: true }).toBuffer()
        if (jpg.byteLength <= limit.maxBytes) return { ok: true, value: { bytes: new Uint8Array(jpg), mime: 'image/jpeg', side } }
      }
    }
    return { ok: false, error: AVATAR_TOO_LARGE(limit.label) }
  } catch {
    return { ok: false, error: 'The image could not be prepared as a profile picture. Choose a different PNG or JPEG.' }
  }
}
