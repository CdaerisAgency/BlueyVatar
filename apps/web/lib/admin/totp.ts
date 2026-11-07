import { createHmac, timingSafeEqual } from 'node:crypto'

/** RFC 6238 time-based one-time codes (SHA-1, 6 digits, 30 second steps), the format every authenticator app reads. */
export const STEP_SEC = 30
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch)
    if (i < 0) throw new Error('Invalid base32 secret')
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function stepAt(nowMs: number): number {
  return Math.floor(nowMs / 1000 / STEP_SEC)
}

export function codeFor(secret: Buffer, step: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', secret).update(msg).digest()
  const off = h[h.length - 1]! & 0xf
  const n = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!
  return String(n % 1_000_000).padStart(6, '0')
}

/** The step the code matches, allowing one step of clock drift either way, or null. */
export function matchStep(secretB32: string, code: string, nowMs: number): number | null {
  const given = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(given)) return null
  const secret = base32Decode(secretB32)
  const now = stepAt(nowMs)
  let hit: number | null = null
  for (const step of [now - 1, now, now + 1]) {
    const want = Buffer.from(codeFor(secret, step))
    if (timingSafeEqual(want, Buffer.from(given))) hit = step
  }
  return hit
}
