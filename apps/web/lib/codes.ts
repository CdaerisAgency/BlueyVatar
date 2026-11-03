import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

/** One-time email codes (spec section 6): 6 digits, 15 minutes, 5 attempts. */
export const CODE_TTL_MS = 15 * 60 * 1000
export const MAX_ATTEMPTS = 5
/** Minimum gap between two code emails for one account. */
export const RESEND_GAP_MS = 60 * 1000

export type PendingCode = {
  did: string
  emailHash: string
  codeHash: string
  masked: string
  attempts: number
  expiresAt: number
  createdAt: number
}

export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

/** SHA256 over the DID, the email hash, and the code. The raw code is never stored. */
export function hashCode(did: string, emailHash: string, code: string): string {
  return createHash('sha256').update(`${did}\n${emailHash}\n${code}`).digest('hex')
}

export function newPending(did: string, emailHash: string, masked: string, code: string, now: number): PendingCode {
  return {
    did,
    emailHash,
    codeHash: hashCode(did, emailHash, code),
    masked,
    attempts: 0,
    expiresAt: now + CODE_TTL_MS,
    createdAt: now,
  }
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'locked' | 'wrong'; attempts: number }

/** Pure check. The caller persists `attempts` on failure and deletes the row on success or expiry. */
export function checkCode(pending: PendingCode, input: string, now: number): VerifyResult {
  if (now >= pending.expiresAt) return { ok: false, reason: 'expired', attempts: pending.attempts }
  if (pending.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked', attempts: pending.attempts }
  const given = Buffer.from(hashCode(pending.did, pending.emailHash, input.trim()), 'hex')
  const want = Buffer.from(pending.codeHash, 'hex')
  if (given.length === want.length && timingSafeEqual(given, want)) return { ok: true }
  return { ok: false, reason: 'wrong', attempts: pending.attempts + 1 }
}
