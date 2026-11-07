/**
 * Profile links (spec sections 3 and 8). app.bsky.actor.profile#links is a list of strongRefs to
 * app.bsky.actor.link records in the same repo. The service reads them and does not copy them
 * into com.blueyvatar.profile.
 */
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

export const LINK_COLLECTION = 'app.bsky.actor.link'

/** An indexed app.bsky.actor.link record. `cid` is the record CID. */
export interface IndexedLinkRecord {
  rkey: string
  cid: string
  url: string
  title: string | null
}

/**
 * Resolve the profile's `links` strongRefs, in order, against the indexed link records of the
 * same repo. A ref is dropped when it is malformed, points at another repo or collection, has no
 * indexed record, or its cid no longer matches (the link was edited after the profile saved it).
 * The https-only sanitizer and the cap of 10 then apply to the resolved URLs.
 */
export function resolveProfileLinks(did: string, refs: unknown, records: IndexedLinkRecord[]): ProfileLink[] {
  if (!Array.isArray(refs)) return []
  const byRkey = new Map(records.map((r) => [r.rkey, r]))
  const prefix = `at://${did}/${LINK_COLLECTION}/`
  const resolved: { url: string; title: string | null }[] = []
  for (const ref of refs.slice(0, MAX_PROFILE_LINKS)) {
    if (!ref || typeof ref !== 'object') continue
    const { uri, cid } = ref as { uri?: unknown; cid?: unknown }
    if (typeof uri !== 'string' || typeof cid !== 'string' || !uri.startsWith(prefix)) continue
    const rec = byRkey.get(uri.slice(prefix.length))
    if (rec && rec.cid === cid) resolved.push({ url: rec.url, title: rec.title })
  }
  return sanitizeProfileLinks(resolved)
}
