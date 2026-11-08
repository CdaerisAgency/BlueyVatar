import sharp from 'sharp'
import { centerPixelCrop, pixelCrop, type CropParams } from '@blueyvatar/core'
import type { ImageMime } from './records'
import { MAX_INPUT_PIXELS } from './server-resize'

/** The Bluesky profile lexicon: avatar is PNG or JPEG, at most 1,000,000 bytes (spec section 5). */
export const BSKY_AVATAR_MAX_BYTES = 1_000_000

/** Each step keeps this share of the previous side, so every size comes from the source and none is fixed. */
const SHRINK_FACTORS = [1, 0.85, 0.7, 0.55, 0.4, 0.3] as const
const JPEG_QUALITIES = [90, 80, 70] as const

export type BskyAvatarImage = { bytes: Uint8Array; mime: ImageMime; side: number }
export type BskyAvatarImageResult = { ok: true; value: BskyAvatarImage } | { ok: false; error: string }

export const BSKY_AVATAR_TOO_LARGE = 'This image is still larger than the 1 MB limit for profile avatars after shrinking it. Choose a simpler or smaller image.'

/**
 * Turns a stored avatar into what Bluesky accepts: the square region the user chose (or the center square),
 * as a PNG when that fits and a JPEG otherwise, under BSKY_AVATAR_MAX_BYTES. Metadata is dropped except the
 * color profile. The side length is derived from the source and shrunk by factors, never hardcoded.
 */
export async function prepareBlueskyAvatar(source: Uint8Array, crop?: CropParams | null): Promise<BskyAvatarImageResult> {
  try {
    const open = () => sharp(Buffer.from(source), { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'warning' }).rotate()
    const { data, info } = await open().toBuffer({ resolveWithObject: true })
    const region = crop ? pixelCrop(crop, info.width, info.height) : centerPixelCrop(info.width, info.height)
    const square = await sharp(data).extract({ left: region.left, top: region.top, width: region.size, height: region.size }).toBuffer()
    const base = (side: number) => sharp(square).keepIccProfile().resize({ width: side, height: side, fit: 'fill', withoutEnlargement: true })
    for (const f of SHRINK_FACTORS) {
      const side = Math.max(1, Math.round(region.size * f))
      const png = await base(side).png({ compressionLevel: 9 }).toBuffer()
      if (png.byteLength <= BSKY_AVATAR_MAX_BYTES) return { ok: true, value: { bytes: new Uint8Array(png), mime: 'image/png', side } }
      for (const quality of JPEG_QUALITIES) {
        const jpg = await base(side).flatten({ background: '#fff' }).jpeg({ quality, mozjpeg: true }).toBuffer()
        if (jpg.byteLength <= BSKY_AVATAR_MAX_BYTES) return { ok: true, value: { bytes: new Uint8Array(jpg), mime: 'image/jpeg', side } }
      }
    }
    return { ok: false, error: BSKY_AVATAR_TOO_LARGE }
  } catch {
    return { ok: false, error: 'The image could not be prepared as a profile avatar. Choose a different PNG or JPEG.' }
  }
}
