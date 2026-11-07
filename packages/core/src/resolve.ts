import { ratingAllowed, type Rating } from './ratings.js'
import { imagePath } from './sign.js'
import type { BlobRef } from './adapters.js'

/** One avatar candidate found for an identity, in resolution order (spec section 7). */
export interface Candidate {
  source: 'blueyvatar-default' | 'blueyvatar' | `adapter:${string}`
  did: string
  blob: BlobRef
  rating: Rating
}

export type Resolution =
  | { kind: 'image'; candidate: Candidate }
  | { kind: 'default' }

/**
 * Pick the first candidate whose rating passes. Candidates must already be
 * ordered: default service image, other service images, then adapters.
 */
export function pickCandidate(
  candidates: readonly Candidate[],
  maxRating: Rating,
  forceDefault: boolean,
): Resolution {
  if (forceDefault) return { kind: 'default' }
  for (const c of candidates) {
    if (ratingAllowed(c.rating, maxRating)) return { kind: 'image', candidate: c }
  }
  return { kind: 'default' }
}

export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/** Sizes the service treats as common (spec section 4). Used to purge and warm `/img` URLs. */
export const IMAGE_SIZE_LADDER = [16, 24, 32, 48, 64, 80, 96, 128, 160, 192, 256, 320, 512, 1024, 2048] as const
/** Subset of the ladder worth warming after an avatar change. */
export const WARM_SIZES = [48, 80, 128, 256, 512] as const
export const IMAGE_FORMATS = ['png', 'jpeg', 'webp'] as const

/**
 * Public-scope `/img` paths for the size ladder at the default quality, signed with the
 * delivery signing secret. Callers that request a size off the ladder, a `-q` quality
 * override, or a restricted avatar (per-caller scope) are not covered.
 */
export function ladderPaths(secret: string, did: string, cid: string, sizes: readonly number[] = IMAGE_SIZE_LADDER, formats: readonly ('png' | 'jpeg' | 'webp')[] = IMAGE_FORMATS): string[] {
  return sizes.flatMap((s) => formats.map((f) => imagePath(secret, did, cid, s, f)))
}
