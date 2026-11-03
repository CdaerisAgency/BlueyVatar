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

/** Immutable, CDN-cacheable image path (spec sections 7 and 14.1). */
export function imagePath(did: string, cid: string, size: number, ext: 'png' | 'jpeg' | 'webp', quality?: number): string {
  const q = quality !== undefined && ext !== 'png' ? `-q${quality}` : ''
  return `/img/${encodeURIComponent(did)}/${cid}/${size}${q}.${ext}`
}

export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
