import { isRating, type Rating } from './ratings.js'
import { ENTITLEMENTS, type OutputFormat, type Tier } from './tiers.js'

/** Query parameters from spec section 7. */
export const DEFAULT_STYLES = [
  '404', 'mp', 'identicon', 'monsterid', 'wavatar', 'retro', 'robohash', 'pagan', 'initials',
] as const
export type DefaultStyle = (typeof DEFAULT_STYLES)[number]

export interface AvatarParams {
  size: number
  default: { kind: 'style'; style: DefaultStyle } | { kind: 'url'; url: string } | { kind: 'service' }
  forceDefault: boolean
  rating: Rating
  format: OutputFormat
  quality: number
  json: boolean
  ttlSeconds: number
  /** Parameters the caller sent that the tier ignored or clamped. */
  adjusted: string[]
}

export const ABSOLUTE_MAX_SIZE = 2048
export const DEFAULT_SIZE = 80
export const DEFAULT_QUALITY = 85
export const DEFAULT_TTL_SECONDS = 24 * 3600
const MIN_TTL = 3600
const MAX_TTL = 28 * 24 * 3600

export class ParamError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

function parseIntStrict(v: string): number | null {
  return /^\d+$/.test(v) ? Number.parseInt(v, 10) : null
}

/**
 * Parses `ttl` as `<n>h` or `<n>d`. The accepted range is 1h to 28d (enforced in
 * parseAvatarParams). Trade-off: a browser keeps the redirect for the whole ttl, so an
 * avatar change reaches it only after up to one ttl. Free tier is fixed at 24h.
 */
export function parseTtl(v: string): number | null {
  const m = /^(\d+)([hd])$/.exec(v)
  if (!m) return null
  const n = Number.parseInt(m[1]!, 10)
  return m[2] === 'h' ? n * 3600 : n * 86400
}

export interface ParseOptions {
  tier: Tier
  /** Hostnames allowed for d=<url>. */
  defaultUrlAllowlist: readonly string[]
}

export function parseAvatarParams(q: URLSearchParams, opts: ParseOptions): AvatarParams {
  const ent = ENTITLEMENTS[opts.tier]
  const adjusted: string[] = []

  let size = DEFAULT_SIZE
  const s = q.get('s') ?? q.get('size')
  if (s !== null) {
    const n = parseIntStrict(s)
    if (n === null || n < 1) throw new ParamError('invalid_size', 's must be an integer from 1 to 2048')
    size = Math.min(n, ABSOLUTE_MAX_SIZE)
  }
  if (size > ent.maxSize) {
    size = ent.maxSize
    adjusted.push('s')
  }

  let def: AvatarParams['default'] = { kind: 'service' }
  const d = q.get('d') ?? q.get('default')
  if (d !== null && d !== '') {
    if ((DEFAULT_STYLES as readonly string[]).includes(d)) {
      def = { kind: 'style', style: d as DefaultStyle }
    } else {
      let url: URL
      try {
        url = new URL(d)
      } catch {
        throw new ParamError('invalid_default', 'd must be a known style or an HTTPS URL')
      }
      if (url.protocol !== 'https:' || !opts.defaultUrlAllowlist.includes(url.hostname)) {
        throw new ParamError('default_url_not_allowed', 'd URL must be HTTPS and on the allowlist')
      }
      if (ent.customDefaultUrl) def = { kind: 'url', url: url.toString() }
      else adjusted.push('d')
    }
  }

  const f = q.get('f') ?? q.get('forcedefault')
  const forceDefault = f === 'y'

  const r = (q.get('r') ?? q.get('rating') ?? 'g').toLowerCase()
  if (!isRating(r)) throw new ParamError('invalid_rating', 'r must be g, pg, r, or x')

  let format: OutputFormat = 'png'
  const fmt = q.get('fmt')
  if (fmt !== null) {
    if (fmt !== 'png' && fmt !== 'jpeg' && fmt !== 'webp') {
      throw new ParamError('invalid_format', 'fmt must be png, jpeg, or webp')
    }
    if (ent.formats.includes(fmt)) format = fmt
    else adjusted.push('fmt')
  }

  let quality = DEFAULT_QUALITY
  const qq = q.get('q')
  if (qq !== null) {
    const n = parseIntStrict(qq)
    if (n === null || n < 1 || n > 100) throw new ParamError('invalid_quality', 'q must be 1 to 100')
    if (ent.formats.length > 1) quality = n
    else adjusted.push('q')
  }

  let ttlSeconds = DEFAULT_TTL_SECONDS
  const ttl = q.get('ttl')
  if (ttl !== null) {
    const n = parseTtl(ttl)
    if (n === null || n < MIN_TTL || n > MAX_TTL) {
      throw new ParamError('invalid_ttl', 'ttl must be between 1h and 28d, for example 6h or 7d')
    }
    if (ent.ttlControl) ttlSeconds = n
    else adjusted.push('ttl')
  }

  return {
    size,
    default: def,
    forceDefault,
    rating: r,
    format,
    quality,
    json: q.get('json') === 'true',
    ttlSeconds,
    adjusted,
  }
}
