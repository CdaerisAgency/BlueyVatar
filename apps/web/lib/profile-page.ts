/** Pure helpers for /p/[handle]: link-preview metadata and the fields the page shows. */
import { GALLERY_MAX, sanitizeProfileLinks, type ProfileLink } from '@blueyvatar/core'

export interface PublicProfile {
  did: string
  handle: string | null
  displayName: string | null
  description: string | null
  links?: unknown
  avatar: { url: string } | null
  jobTitle: string | null
  company: string | null
  location: string | null
  pronouns: string | null
  timezone?: string | null
  interests?: unknown
  gallery?: unknown
  verifiedAccounts?: { platform: string; uri: string; hidden: boolean }[]
}

/** Links come from the delivery JSON, but are checked again here so the page never renders a non-https href. */
export const pageLinks = (p: PublicProfile): ProfileLink[] => sanitizeProfileLinks(p.links)

export const pageInterests = (p: PublicProfile): string[] =>
  Array.isArray(p.interests) ? p.interests.filter((i): i is string => typeof i === 'string' && i.trim() !== '').slice(0, 20) : []

export interface GalleryImage { url: string; caption: string | null }

/**
 * Gallery images the page renders. Plus users only (the profile JSON already leaves the gallery
 * out for others, and this checks again). Only signed /img paths count, so a raw PDS URL never
 * renders. The cap is applied here too.
 */
export function pageGallery(p: PublicProfile, plus: boolean): GalleryImage[] {
  if (!plus || !Array.isArray(p.gallery)) return []
  const out: GalleryImage[] = []
  for (const g of p.gallery as unknown[]) {
    if (typeof g !== 'object' || g === null) continue
    const { url, caption } = g as { url?: unknown; caption?: unknown }
    if (typeof url !== 'string' || !url.startsWith('/img/')) continue
    out.push({ url, caption: typeof caption === 'string' && caption.trim() !== '' ? caption : null })
    if (out.length >= GALLERY_MAX) break
  }
  return out
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s)

/** Open Graph and Twitter card fields. `imageBase` is the public delivery origin. */
export function profileMetadata(p: PublicProfile, handle: string, imageBase: string) {
  const title = p.displayName ?? p.handle ?? handle
  const description = clip(
    p.description?.trim() || [[p.jobTitle, p.company].filter(Boolean).join(', '), p.location].filter(Boolean).join(' | ') || `${title} on BlueyVatar`,
    200,
  )
  const images = p.avatar ? [`${imageBase.replace(/\/+$/, '')}${p.avatar.url}`] : []
  return {
    title,
    description,
    openGraph: { title, description, type: 'profile' as const, images },
    twitter: { card: 'summary' as const, title, description, images },
  }
}
