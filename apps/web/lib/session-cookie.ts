import { createHmac, timingSafeEqual } from 'node:crypto'

/** Signed session cookie that holds the DID only. Format: did.expiresAtMs.hmac */
export const COOKIE_NAME = 'bv_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function mac(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

export function signSession(did: string, secret: string, now: number): string {
  const body = `${did}.${now + SESSION_TTL_MS}`
  return `${body}.${mac(secret, body)}`
}

export function readSession(value: string | undefined, secret: string, now: number): string | null {
  if (!value) return null
  const i = value.lastIndexOf('.')
  const j = value.lastIndexOf('.', i - 1)
  if (i < 0 || j < 0) return null
  const body = value.slice(0, i)
  const given = Buffer.from(value.slice(i + 1))
  const want = Buffer.from(mac(secret, body))
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null
  if (Number(value.slice(j + 1, i)) <= now) return null
  return value.slice(0, j)
}
