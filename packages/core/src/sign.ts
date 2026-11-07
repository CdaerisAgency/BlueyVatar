import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed `/img` paths (issues #68 and #72). The redirect routes sign the path they send the
 * browser to, and `/img` serves nothing without a valid signature. The signature covers the
 * DID, the blob CID, the file name (size, quality, format) and a scope, so a caller cannot
 * edit the size out of a URL it was given and the tier size cap holds on `/img` too.
 *
 * Path shape: `/img/{did}/{cid}/{sig}/{size}[-q{quality}].{ext}`. The signature sits before
 * the file name so the path still ends in an image extension and Cloudflare caches it by
 * extension (spec section 14.1). The segment is `{mac}` for an empty scope and
 * `{scope-base64url}.{mac}` otherwise.
 *
 * Scope: empty for a public avatar, so the URL is identical for every caller and the CDN
 * holds one copy. A restricted avatar (keyed only or domain allowlist, spec section 10.2)
 * gets the caller's key id or allowed domain plus a day bucket. Tradeoff: restricted avatars
 * cache once per caller per day instead of once, and a leaked restricted URL stops working
 * at the end of the following day.
 */
export type ImageFormat = 'png' | 'jpeg' | 'webp'

export const SIGNATURE_BYTES = 16
const MAC_RE = /^(?:([A-Za-z0-9_-]+)\.)?([A-Za-z0-9_-]{22})$/

export function imageFile(size: number, ext: ImageFormat, quality?: number): string {
  const q = quality !== undefined && ext !== 'png' ? `-q${quality}` : ''
  return `${size}${q}.${ext}`
}

export function imageMac(secret: string, did: string, cid: string, file: string, scope: string): string {
  return createHmac('sha256', secret)
    .update(`img\n${did}\n${cid}\n${file}\n${scope}`)
    .digest()
    .subarray(0, SIGNATURE_BYTES)
    .toString('base64url')
}

/** Signature path segment for the given scope. */
export function imageSig(secret: string, did: string, cid: string, file: string, scope = ''): string {
  const mac = imageMac(secret, did, cid, file, scope)
  return scope ? `${Buffer.from(scope).toString('base64url')}.${mac}` : mac
}

/** Immutable, CDN-cacheable, signed image path (spec sections 7 and 14.1). */
export function imagePath(secret: string, did: string, cid: string, size: number, ext: ImageFormat, quality?: number, scope = ''): string {
  const file = imageFile(size, ext, quality)
  return `/img/${encodeURIComponent(did)}/${cid}/${imageSig(secret, did, cid, file, scope)}/${file}`
}

/**
 * Checks the signature segment of a `/img` path. Returns the decoded scope when the MAC
 * matches, or null when the segment is malformed or signed with another secret.
 */
export function verifyImageSig(secret: string, did: string, cid: string, file: string, sig: string): string | null {
  const m = MAC_RE.exec(sig)
  if (!m) return null
  const scope = m[1] ? Buffer.from(m[1], 'base64url').toString() : ''
  const expected = Buffer.from(imageMac(secret, did, cid, file, scope), 'base64url')
  const got = Buffer.from(m[2]!, 'base64url')
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null
  return scope
}

/** Day number used as the expiry bucket of a restricted scope. */
export function dayBucket(now = Date.now()): number {
  return Math.floor(now / 86_400_000)
}

/** Scope for a restricted avatar: who the URL was issued to, and the day it was issued. */
export function restrictedScope(caller: string, now = Date.now()): string {
  return `${caller}:${dayBucket(now)}`
}

/** A restricted scope is valid on the day it was issued and the day after. */
export function scopeExpired(scope: string, now = Date.now()): boolean {
  const day = Number(scope.slice(scope.lastIndexOf(':') + 1))
  if (!Number.isInteger(day)) return true
  const today = dayBucket(now)
  return day > today || day < today - 1
}
