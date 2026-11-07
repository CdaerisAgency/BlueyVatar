import { createHmac, timingSafeEqual } from 'node:crypto'

/** Signed session cookie that holds the DID only. Format: did.expiresAtMs.hmac */
export const COOKIE_NAME = 'bv_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function mac(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

/** Session ids are `s` plus 22 base64url characters (16 random bytes). */
const SID = /^s[A-Za-z0-9_-]{22}$/

export type SessionClaims = { did: string; sid: string | null; issuedAt: number }

/**
 * New cookies read `did.expiresAtMs.sid.hmac` so the server can list and revoke them. Cookies issued before
 * sessions were tracked read `did.expiresAtMs.hmac`; they stay valid until they expire or the account signs out everywhere.
 */
export function signSession(did: string, secret: string, now: number, sid?: string): string {
  const body = sid ? `${did}.${now + SESSION_TTL_MS}.${sid}` : `${did}.${now + SESSION_TTL_MS}`
  return `${body}.${mac(secret, body)}`
}

export function parseSession(value: string | undefined, secret: string, now: number): SessionClaims | null {
  if (!value) return null
  const i = value.lastIndexOf('.')
  if (i < 0) return null
  const body = value.slice(0, i)
  const given = Buffer.from(value.slice(i + 1))
  const want = Buffer.from(mac(secret, body))
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null
  const j = body.lastIndexOf('.')
  if (j < 0) return null
  let did = body.slice(0, j)
  let exp = body.slice(j + 1)
  let sid: string | null = null
  if (SID.test(exp)) {
    sid = exp
    const k = did.lastIndexOf('.')
    if (k < 0) return null
    exp = did.slice(k + 1)
    did = did.slice(0, k)
  }
  const expiresAt = Number(exp)
  if (!did || !Number.isFinite(expiresAt) || expiresAt <= now) return null
  return { did, sid, issuedAt: expiresAt - SESSION_TTL_MS }
}

export function readSession(value: string | undefined, secret: string, now: number): string | null {
  return parseSession(value, secret, now)?.did ?? null
}
