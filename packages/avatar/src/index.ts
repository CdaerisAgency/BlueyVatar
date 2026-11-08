/**
 * blueyvatar avatar URL builder. No server dependencies: it runs in browsers and Node 18+.
 * Parameter names follow the delivery API (docs/api): s, d, r, f, fmt, q, token.
 */
export const DEFAULT_BASE_URL = 'https://img.blueyvatar.com'

export type Rating = 'g' | 'pg' | 'r' | 'x'
export type Format = 'png' | 'jpeg' | 'webp'
export type DefaultStyle =
  | '404' | 'mp' | 'identicon' | 'monsterid' | 'wavatar' | 'retro' | 'robohash' | 'pagan' | 'initials' | 'blank'

const STYLES: readonly string[] = ['404', 'mp', 'identicon', 'monsterid', 'wavatar', 'retro', 'robohash', 'pagan', 'initials', 'blank']
const RATINGS: readonly string[] = ['g', 'pg', 'r', 'x']
const FORMATS: readonly string[] = ['png', 'jpeg', 'webp']

/**
 * Same normalization as the server: trim, lowercase, SHA-256 hex of the UTF-8 bytes
 * (docs/api/hashing-v1.md). Uses Web Crypto, which browsers and Node 18+ provide.
 */
export async function emailHash(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase())
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface AvatarUrlOptions {
  /** SHA-256 hex (64) or MD5 hex (32) of the email. Use `emailHash` to compute it. */
  hash?: string
  /** Handle such as `alice.example.com`. */
  handle?: string
  /** DID such as `did:plc:abc123`. */
  did?: string
  /** Square size in pixels, 1 to 2048. Tier caps apply on the server. */
  size?: number
  /** Default style, or an HTTPS URL on the service allowlist (Plus and higher). */
  default?: DefaultStyle | (string & {})
  /** Always return the default image. */
  forceDefault?: boolean
  rating?: Rating
  format?: Format
  /** 1 to 100. Ignored for PNG and on the Free tier. */
  quality?: number
  /** Publishable key (`pk_...`). Never put a secret key in a URL. */
  key?: string
  /** Initials source for `d=initials` on hash lookups. */
  name?: string
  /** Delivery origin. Defaults to https://img.blueyvatar.com. */
  baseUrl?: string
}

function origin(baseUrl: string | undefined): string {
  return (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
}

function exactlyOne(o: AvatarUrlOptions): void {
  const n = [o.hash, o.handle, o.did].filter((v) => v !== undefined && v !== '').length
  if (n !== 1) throw new TypeError('avatarUrl needs exactly one of hash, handle, or did')
}

/** Builds an avatar URL. Throws TypeError on input the API would reject with a 400. */
export function avatarUrl(o: AvatarUrlOptions): string {
  exactlyOne(o)
  const q = new URLSearchParams()
  if (o.size !== undefined) {
    if (!Number.isInteger(o.size) || o.size < 1 || o.size > 2048) throw new TypeError('size must be an integer from 1 to 2048')
    q.set('s', String(o.size))
  }
  if (o.default !== undefined && o.default !== '') {
    if (!STYLES.includes(o.default) && !/^https:\/\//i.test(o.default)) {
      throw new TypeError('default must be a known style or an HTTPS URL')
    }
    q.set('d', o.default)
  }
  if (o.forceDefault) q.set('f', 'y')
  if (o.rating !== undefined) {
    if (!RATINGS.includes(o.rating)) throw new TypeError('rating must be g, pg, r, or x')
    q.set('r', o.rating)
  }
  if (o.format !== undefined) {
    if (!FORMATS.includes(o.format)) throw new TypeError('format must be png, jpeg, or webp')
    q.set('fmt', o.format)
  }
  if (o.quality !== undefined) {
    if (!Number.isInteger(o.quality) || o.quality < 1 || o.quality > 100) throw new TypeError('quality must be an integer from 1 to 100')
    q.set('q', String(o.quality))
  }
  if (o.name) q.set('name', o.name)
  if (o.key) q.set('token', o.key)

  let path: string
  if (o.hash !== undefined && o.hash !== '') {
    const h = o.hash.toLowerCase()
    if (!/^([0-9a-f]{64}|[0-9a-f]{32})$/.test(h)) throw new TypeError('hash must be 64 (SHA-256) or 32 (MD5) hex characters; use emailHash(email)')
    path = `/avatar/${h}`
  } else {
    const id = (o.did ?? o.handle ?? '').trim().replace(/^@/, '')
    if (o.did !== undefined && !/^did:(plc|web):[a-zA-Z0-9._:%-]+$/.test(id)) throw new TypeError('did must look like did:plc:... or did:web:...')
    if (o.handle !== undefined && !/^[a-zA-Z0-9.-]{1,253}$/.test(id)) throw new TypeError('handle contains invalid characters')
    path = `/u/${encodeURIComponent(o.did !== undefined ? id : id.toLowerCase())}`
  }
  const qs = q.toString()
  return origin(o.baseUrl) + path + (qs ? `?${qs}` : '')
}

export interface ProfileUrlOptions {
  /** Handle, DID, or SHA-256 hash. A raw email address is rejected by the API, so it is rejected here too. */
  id: string
  key?: string
  baseUrl?: string
}

/** URL of the profile JSON endpoint (`/profile/{id}`). */
export function profileUrl(o: ProfileUrlOptions): string {
  const id = o.id.trim().replace(/^@/, '')
  if (!/^[A-Za-z0-9._:%-]{1,253}$/.test(id)) throw new TypeError('id must be a handle, DID, or SHA-256 hash, not an email address')
  const qs = o.key ? `?token=${encodeURIComponent(o.key)}` : ''
  return `${origin(o.baseUrl)}/profile/${encodeURIComponent(id)}${qs}`
}

export interface GravatarMigration {
  options: AvatarUrlOptions
  /** Plain-language differences the caller should know about. */
  notes: string[]
}

/**
 * Maps a Gravatar avatar URL to blueyvatar options. Handles `s`, `d`, `r`, and `f` (and their long
 * names). Gravatar's SHA-256 and MD5 hashes are both accepted by blueyvatar. Pass the result's
 * `options` to `avatarUrl`. Throws TypeError when the URL has no avatar hash.
 */
export function fromGravatarUrl(url: string | URL, base: { baseUrl?: string; key?: string } = {}): GravatarMigration {
  const u = typeof url === 'string' ? new URL(url) : url
  const m = /^\/avatar\/([0-9a-fA-F]{32}|[0-9a-fA-F]{64})(?:\.[A-Za-z]+)?\/?$/.exec(u.pathname)
  if (!m) throw new TypeError('not a Gravatar avatar URL: expected /avatar/{hash}')
  const options: AvatarUrlOptions = { hash: m[1]!.toLowerCase() }
  if (base.baseUrl) options.baseUrl = base.baseUrl
  if (base.key) options.key = base.key
  const notes: string[] = []
  const p = u.searchParams

  const s = p.get('s') ?? p.get('size')
  if (s !== null) {
    const n = /^\d+$/.test(s) ? Number.parseInt(s, 10) : 0
    if (n >= 1) options.size = Math.min(n, 2048)
    else notes.push(`Dropped size "${s}": it is not a positive integer.`)
  }

  const d = p.get('d') ?? p.get('default')
  if (d !== null && d !== '') {
    if (d === 'mm') options.default = 'mp'
    else if (STYLES.includes(d)) options.default = d as DefaultStyle
    else if (/^https:\/\//i.test(d)) {
      options.default = d
      notes.push('Custom default URLs need an HTTPS host on the service allowlist and a Plus key or higher. Otherwise the style default is used.')
    } else if (d === 'color') notes.push('Dropped d=color: blueyvatar does not support it.')
    else notes.push(`Dropped default "${d}": not a blueyvatar style or an HTTPS URL.`)
  }

  const f = p.get('f') ?? p.get('forcedefault')
  if (f === 'y') options.forceDefault = true

  const r = p.get('r') ?? p.get('rating')
  if (r !== null) {
    const rr = r.toLowerCase()
    if (RATINGS.includes(rr)) {
      options.rating = rr as Rating
      notes.push('Ratings differ: Gravatar rates images by its own rules, while blueyvatar derives the rating from atproto self-labels. The same image can rate differently (docs/api/gravatar-differences-v1.md).')
    } else notes.push(`Dropped rating "${r}": expected g, pg, r, or x.`)
  }
  return { options, notes }
}
