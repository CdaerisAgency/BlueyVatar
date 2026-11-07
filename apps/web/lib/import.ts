/**
 * Import existing avatars (spec section 3, row 26): pure helpers and a capped fetch.
 *
 * URL formats, checked against the services' documentation:
 * - Gravatar, https://docs.gravatar.com/api/avatars/images/ : `https://gravatar.com/avatar/{sha256}`
 *   takes a SHA256 hash of the trimmed, lowercased email. `s` is the size in pixels (1 to 2048),
 *   `d=404` returns HTTP 404 instead of a default image, and `r` is the maximum rating
 *   (g, pg, r, x). We ask for `r=x` so the user's image comes back whatever its rating is, and
 *   the user confirms the rating before it is saved.
 * - Libravatar, https://wiki.libravatar.org/api/ : `https://seccdn.libravatar.org/avatar/{sha256}`
 *   accepts a SHA256 hash, `s` (1 to 512), and `d=404`. seccdn is the HTTPS endpoint.
 *
 * Only fixed hosts are ever contacted. Callers pass an email hash from the user's own links, never a URL.
 */
import { isSha256Hex, ratingFromLabels, type Rating } from '@blueyvatar/core'
import { MAX_BLOB_BYTES, MAX_BLOB_MESSAGE, labelValues, validateImageBytes, type Check, type ImageMime } from './records'

export const IMPORT_SOURCES = ['bluesky', 'gravatar', 'libravatar'] as const
export type ImportSource = (typeof IMPORT_SOURCES)[number]

export const IMPORT_TIMEOUT_MS = 8000
const MAX_REDIRECTS = 3

/** Hosts the importer may contact, including redirect targets. HTTPS only. */
export const ALLOWED_IMPORT_HOSTS: readonly string[] = ['gravatar.com', 'www.gravatar.com', 'secure.gravatar.com', 'seccdn.libravatar.org', 'cdn.libravatar.org']
const ALLOWED_HOST_SUFFIXES = ['.gravatar.com', '.libravatar.org']

export function isAllowedImportUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
  const host = u.hostname.toLowerCase()
  return ALLOWED_IMPORT_HOSTS.includes(host) || ALLOWED_HOST_SUFFIXES.some((s) => host.endsWith(s))
}

export function gravatarUrl(hash: string): string {
  if (!isSha256Hex(hash)) throw new Error('Expected a SHA256 hex hash')
  return `https://gravatar.com/avatar/${hash}?${new URLSearchParams({ s: '1024', d: '404', r: 'x' })}`
}

export function libravatarUrl(hash: string): string {
  if (!isSha256Hex(hash)) throw new Error('Expected a SHA256 hex hash')
  return `https://seccdn.libravatar.org/avatar/${hash}?${new URLSearchParams({ s: '512', d: '404' })}`
}

export const parseImportSource = (raw: string): ImportSource | null => ((IMPORT_SOURCES as readonly string[]).includes(raw) ? (raw as ImportSource) : null)

export const sourceLabel = (s: ImportSource): string => ({ bluesky: 'Bluesky', gravatar: 'Gravatar', libravatar: 'Libravatar' })[s]

/**
 * Rating to preselect on the confirm form, or null when the user must choose.
 * Bluesky profiles with no labels default to G. A labeled Bluesky avatar preselects the mapped
 * rating. Gravatar and Libravatar never preselect: the user confirms the rating (issue 35).
 */
export function suggestedRating(source: ImportSource, bskyLabels: unknown): Rating | null {
  if (source !== 'bluesky') return null
  const vals = labelValues(bskyLabels)
  return vals.length === 0 ? 'g' : ratingFromLabels(vals)
}

export type BlobMeta = { cid: string; mimeType: string; size: number }

/** Pull the avatar blob out of an app.bsky.actor.profile record. */
export function bskyAvatarBlob(record: unknown): Check<BlobMeta> {
  const av = (record as { avatar?: { ref?: { $link?: unknown }; mimeType?: unknown; size?: unknown } } | null)?.avatar
  const cid = av?.ref?.$link
  if (typeof cid !== 'string' || !/^[a-z0-9]{10,100}$/.test(cid)) return { ok: false, error: 'Your Bluesky profile has no avatar to import.' }
  const mimeType = typeof av?.mimeType === 'string' ? av.mimeType : ''
  const size = typeof av?.size === 'number' ? av.size : 0
  if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') return { ok: false, error: 'Only PNG and JPEG images are supported. Your Bluesky avatar is a different type.' }
  if (size > MAX_BLOB_BYTES) return { ok: false, error: `Your Bluesky avatar is larger than 5 MB (${MAX_BLOB_BYTES.toLocaleString('en-US')} bytes). Upload a smaller file directly instead.` }
  return { ok: true, value: { cid, mimeType, size } }
}

/** Read a response body, stopping once more than maxBytes arrive. Returns null when over the cap. */
export async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    void res.body?.cancel().catch(() => {})
    return null
  }
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer())
    return all.length > maxBytes ? null : all
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      void reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

export type RemoteImage = { bytes: Uint8Array; mime: ImageMime }

/**
 * Fetch an image from an allowed host with a timeout, a size cap, and manual redirects that are
 * re-checked against the allowlist. A 404 means the service has no image for this hash.
 */
export async function fetchRemoteImage(url: string, source: 'Gravatar' | 'Libravatar', fetchImpl: typeof fetch = fetch): Promise<Check<RemoteImage>> {
  let current = url
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isAllowedImportUrl(current)) return { ok: false, error: `${source} sent us somewhere we do not fetch from. Upload the image directly instead.` }
      const res = await fetchImpl(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS),
        headers: { accept: 'image/png,image/jpeg', 'user-agent': 'blueyvatar-import' },
      })
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        void res.body?.cancel().catch(() => {})
        if (!loc) break
        current = new URL(loc, current).toString()
        continue
      }
      if (res.status === 404) {
        void res.body?.cancel().catch(() => {})
        return { ok: false, error: `${source} has no image for this email.` }
      }
      if (!res.ok) {
        void res.body?.cancel().catch(() => {})
        return { ok: false, error: `${source} could not be reached (${res.status}). Try again later.` }
      }
      const bytes = await readCapped(res, MAX_BLOB_BYTES)
      if (!bytes) return { ok: false, error: `The ${source} image is larger than 5 MB (${MAX_BLOB_BYTES.toLocaleString('en-US')} bytes). Upload a smaller file directly instead.` }
      const v = validateImageBytes(bytes)
      if (!v.ok) return { ok: false, error: v.error }
      return { ok: true, value: { bytes, mime: v.value.mime } }
    }
    return { ok: false, error: `${source} redirected too many times.` }
  } catch {
    return { ok: false, error: `${source} did not respond in time. Try again later.` }
  }
}

export const fetchGravatar = (hash: string, f?: typeof fetch) => fetchRemoteImage(gravatarUrl(hash), 'Gravatar', f)
export const fetchLibravatar = (hash: string, f?: typeof fetch) => fetchRemoteImage(libravatarUrl(hash), 'Libravatar', f)
