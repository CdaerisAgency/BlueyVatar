/** Rating to self-label mapping from spec section 9 (a design proposal). */
export const RATINGS = ['g', 'pg', 'r', 'x'] as const
export type Rating = (typeof RATINGS)[number]

export function isRating(v: string): v is Rating {
  return (RATINGS as readonly string[]).includes(v)
}

/** Derive a rating from atproto self-label values. Highest label wins. */
export function ratingFromLabels(labels: readonly string[] | undefined): Rating {
  const set = new Set(labels ?? [])
  if (set.has('porn')) return 'x'
  if (set.has('sexual') || set.has('graphic-media')) return 'r'
  if (set.has('nudity')) return 'pg'
  return 'g'
}

export function ratingAllowed(image: Rating, maxAllowed: Rating): boolean {
  return RATINGS.indexOf(image) <= RATINGS.indexOf(maxAllowed)
}

/** Account-level labels on app.bsky.actor.profile raise the fallback avatar's rating. */
export function maxRating(a: Rating, b: Rating): Rating {
  return RATINGS.indexOf(a) >= RATINGS.indexOf(b) ? a : b
}
