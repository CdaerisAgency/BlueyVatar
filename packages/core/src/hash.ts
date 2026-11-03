import { createHash } from 'node:crypto'

/** The delivery API accepts only SHA256 hex hashes (spec sections 6 and 7). */
const SHA256_HEX = /^[0-9a-f]{64}$/

export function isSha256Hex(value: string): boolean {
  return SHA256_HEX.test(value)
}

/** Same normalization Gravatar uses: trim, lowercase, SHA256 hex. */
export function emailHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}

const DID = /^did:(plc|web):[a-zA-Z0-9._:%-]+$/
const HANDLE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/

export type Identifier =
  | { kind: 'did'; value: string }
  | { kind: 'handle'; value: string }
  | { kind: 'hash'; value: string }

export function parseIdentifier(raw: string): Identifier | null {
  const v = raw.trim()
  if (isSha256Hex(v.toLowerCase())) return { kind: 'hash', value: v.toLowerCase() }
  if (DID.test(v)) return { kind: 'did', value: v }
  const h = v.replace(/^@/, '').toLowerCase()
  if (h.length <= 253 && HANDLE.test(h)) return { kind: 'handle', value: h }
  return null
}
