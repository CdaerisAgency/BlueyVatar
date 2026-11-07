/** Gallery images (spec section 3 row 21, section 8, section 11.2). */

/** Values of the optional `purpose` field on com.blueyvatar.image. A missing field means `avatar`. */
export const IMAGE_PURPOSES = ['avatar', 'gallery'] as const
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number]

/** Most gallery images a profile page and the profile JSON show. */
export const GALLERY_MAX = 12
/** Longest gallery caption, in characters (lexicon maxLength 140). */
export const GALLERY_CAPTION_MAX = 140

/**
 * Purpose stored for an image record. Absent or non-string means `avatar`. Any other string is kept
 * as written, so a purpose added later never resolves as an avatar here.
 */
export function purposeOf(value: unknown): string {
  return typeof value === 'string' && value !== '' ? value.slice(0, 32) : 'avatar'
}

/** True when `plusDids` (the PLUS_DIDS comma list) names this DID. Plan storage does not exist yet. */
export function isPlusDid(did: string, plusDids: string | undefined): boolean {
  return (plusDids ?? '').split(',').map((d) => d.trim()).includes(did)
}
