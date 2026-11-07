/** Profile links, read from the links field of app.bsky.actor.profile (spec sections 3 and 8). Never copied or stored. */
export const MAX_PROFILE_LINKS = 10
export const MAX_LINK_LABEL_GRAPHEMES = 100
export const MAX_LINK_URL_LENGTH = 2048

export interface ProfileLink {
  label: string
  url: string
}

/**
 * Keep only well-formed https links, at most 10. Accepts a missing or malformed field and
 * returns []. The label falls back to the host when absent. URLs with credentials are dropped.
 */
export function sanitizeProfileLinks(raw: unknown): ProfileLink[] {
  if (!Array.isArray(raw)) return []
  const out: ProfileLink[] = []
  for (const item of raw) {
    if (out.length >= MAX_PROFILE_LINKS) break
    if (!item || typeof item !== 'object') continue
    const { url, label, title } = item as { url?: unknown; label?: unknown; title?: unknown }
    if (typeof url !== 'string' || url.length > MAX_LINK_URL_LENGTH) continue
    let u: URL
    try {
      u = new URL(url.trim())
    } catch {
      continue
    }
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) continue
    const text = [label, title].find((t): t is string => typeof t === 'string' && t.trim() !== '')
    let l = text ? text.trim() : u.hostname
    if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
      l = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(l)].slice(0, MAX_LINK_LABEL_GRAPHEMES).map((s) => s.segment).join('')
    } else l = [...l].slice(0, MAX_LINK_LABEL_GRAPHEMES).join('')
    out.push({ label: l, url: u.href })
  }
  return out
}
