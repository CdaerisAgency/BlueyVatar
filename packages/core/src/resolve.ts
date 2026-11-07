import { ratingAllowed, type Rating } from './ratings.js'
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

/** Sizes the service treats as common (spec section 4). `/img` serves only these. */
export const IMAGE_SIZE_LADDER = [16, 24, 32, 48, 64, 80, 96, 128, 160, 192, 256, 320, 512, 1024, 2048] as const
/** Subset of the ladder worth warming after an avatar change. */
export const WARM_SIZES = [48, 80, 128, 256, 512] as const
export const IMAGE_FORMATS = ['png', 'jpeg', 'webp'] as const
/** Qualities `/img` serves for JPEG and WebP. PNG ignores quality. */
export const IMAGE_QUALITIES = [60, 85] as const
/** Quality that has no `-q` suffix in the canonical path. */
export const CANONICAL_QUALITY = 85

type ImageExt = (typeof IMAGE_FORMATS)[number]

/** Smallest ladder size that is at least `size`, or the largest step when `size` exceeds it. */
export function snapSize(size: number): number {
  return IMAGE_SIZE_LADDER.find((s) => s >= size) ?? IMAGE_SIZE_LADDER[IMAGE_SIZE_LADDER.length - 1]!
}

/** Nearest allowed quality; ties go to the higher one. */
export function snapQuality(quality: number): number {
  let best: number = IMAGE_QUALITIES[0]
  for (const q of IMAGE_QUALITIES) {
    if (Math.abs(q - quality) <= Math.abs(best - quality)) best = q
  }
  return best
}

/**
 * The one canonical, CDN-cacheable path per image variant (spec sections 7 and 14.1). Size snaps
 * up to the ladder and quality to `IMAGE_QUALITIES`. PNG and the default quality carry no `-q`
 * suffix, so every variant has exactly one URL. The avatar redirect, warm, purge, and `/img`
 * itself all build paths here. Every tier cap (512, 1024, 2048) is a ladder step, so snapping a
 * clamped size up never exceeds the cap.
 */
export function imagePath(did: string, cid: string, size: number, ext: ImageExt, quality?: number): string {
  const q = quality === undefined || ext === 'png' ? CANONICAL_QUALITY : snapQuality(quality)
  const suffix = q === CANONICAL_QUALITY ? '' : `-q${q}`
  return `/img/${encodeURIComponent(did)}/${cid}/${snapSize(size)}${suffix}.${ext}`
}

/**
 * Every `/img` path that can exist for a CID: all ladder sizes, all formats, and every allowed
 * quality for JPEG and WebP. Purge covers exactly this set, because `/img` redirects any other
 * request to one of these paths.
 */
export function ladderPaths(did: string, cid: string, sizes: readonly number[] = IMAGE_SIZE_LADDER, formats: readonly ImageExt[] = IMAGE_FORMATS): string[] {
  return sizes.flatMap((s) => formats.flatMap((f) => (
    f === 'png' ? [imagePath(did, cid, s, f)] : IMAGE_QUALITIES.map((q) => imagePath(did, cid, s, f, q))
  )))
}
