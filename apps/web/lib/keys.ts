import { createHash, randomBytes } from 'node:crypto'
import { ENTITLEMENTS, type Tier } from '@blueyvatar/core'

export type KeyKind = 'secret' | 'publishable'

const PREFIX: Record<KeyKind, string> = { secret: 'sk_', publishable: 'pk_' }

/** A new key: `sk_` or `pk_` plus 32 random bytes, base64url (spec section 10.3). */
export function generateKey(kind: KeyKind): string {
  return PREFIX[kind] + randomBytes(32).toString('base64url')
}

/** SHA256 hex of the full key. This matches how the delivery service looks keys up. */
export function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

/** Short, non-secret prefix kept for display, such as `pk_Ab3dEf`. */
export function displayPrefix(key: string): string {
  return key.slice(0, 9)
}

export function keyKindOf(key: string): KeyKind | null {
  return key.startsWith('sk_') ? 'secret' : key.startsWith('pk_') ? 'publishable' : null
}

export interface ActiveKey {
  hash: string
  kind: KeyKind
}

export type LimitCheck = { ok: true } | { ok: false; error: string }

/**
 * Checks whether a license may add a key of this kind. `active` lists unrevoked keys.
 * During a rotation, pass the key being replaced as `replacing` so the swap nets to zero.
 */
export function checkKeyLimit(tier: Tier, kind: KeyKind, active: readonly ActiveKey[], replacing?: string): LimitCheck {
  const current = active.filter((k) => k.hash !== replacing)
  const { maxKeys } = ENTITLEMENTS[tier]
  if (tier === 'free') {
    if (kind === 'secret') return { ok: false, error: 'The Free tier includes one publishable key. Secret keys need a paid tier.' }
    if (current.some((k) => k.kind === 'publishable')) {
      return { ok: false, error: 'The Free tier includes one publishable key. Revoke it or rotate it instead.' }
    }
  }
  if (maxKeys !== null && current.length >= maxKeys) {
    return { ok: false, error: `This tier allows ${maxKeys} active key${maxKeys === 1 ? '' : 's'}. Revoke one first.` }
  }
  return { ok: true }
}

export const MAX_DOMAINS = 50
export const MAX_LABEL = 60

export type DomainResult = { ok: true; value: string } | { ok: false; error: string }

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

function validHost(host: string): boolean {
  if (host.length > 253) return false
  const labels = host.split('.')
  if (!labels.every((l) => LABEL.test(l))) return false
  // Reject IPv4-looking hosts: the last label of a real hostname is not all digits.
  return !/^\d+$/.test(labels[labels.length - 1]!)
}

/** Accepts `localhost`, an exact host such as `app.example.com`, or `*.example.com`. */
export function validateDomain(input: string): DomainResult {
  const v = input.trim().toLowerCase()
  if (!v) return { ok: false, error: 'Empty entry.' }
  if (/[\s/:@?#]/.test(v)) return { ok: false, error: `"${input.trim()}": enter a host only, with no scheme, port, or path.` }
  if (v === 'localhost') return { ok: true, value: v }
  if (v.startsWith('*.')) {
    const base = v.slice(2)
    if (!base.includes('.') || !validHost(base)) {
      return { ok: false, error: `"${input.trim()}": a wildcard needs a full domain, such as *.example.com.` }
    }
    return { ok: true, value: v }
  }
  if (v.includes('*')) return { ok: false, error: `"${input.trim()}": a wildcard is only allowed as a leading "*.".` }
  if (!v.includes('.') || !validHost(v)) {
    return { ok: false, error: `"${input.trim()}" is not a valid host. Use app.example.com, *.example.com, or localhost.` }
  }
  return { ok: true, value: v }
}

export type DomainListResult = { ok: true; domains: string[] } | { ok: false; errors: string[] }

/** Parses a textarea or comma list into a deduplicated, validated list. */
export function parseDomainList(text: string): DomainListResult {
  const parts = text.split(/[\s,]+/).filter(Boolean)
  const seen = new Set<string>()
  const errors: string[] = []
  for (const part of parts) {
    const r = validateDomain(part)
    if (r.ok) seen.add(r.value)
    else errors.push(r.error)
  }
  if (seen.size > MAX_DOMAINS) errors.push(`At most ${MAX_DOMAINS} domains are allowed.`)
  return errors.length > 0 ? { ok: false, errors } : { ok: true, domains: [...seen] }
}

export function cleanLabel(input: string): string | null {
  const v = input.trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL)
  return v === '' ? null : v
}

/** First day of the UTC month as YYYY-MM-DD, matching usage_counters.period_start. */
export function periodStartOf(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
}

/** Monthly periods a tier's usage view covers: Pro 30 days (this and last month), Business 12 months. */
export function historyPeriods(tier: Tier, now: Date): string[] {
  const count = tier === 'free' ? 0 : tier === 'pro' ? 2 : 12
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(periodStartOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))))
  return out
}

export interface Included {
  volume: number | null
  per: 'day' | 'month' | null
}

export function includedVolume(tier: Tier): Included {
  const e = ENTITLEMENTS[tier]
  if (e.keyedMonthly !== null) return { volume: e.keyedMonthly, per: 'month' }
  if (e.keyedDaily !== null) return { volume: e.keyedDaily, per: 'day' }
  return { volume: null, per: null }
}

export type AlertState = 'ok' | 'warn80' | 'over100' | 'n/a'

/** Alert thresholds are monthly (spec section 12), so only monthly-included tiers have one. */
export function alertState(tier: Tier, used: number): AlertState {
  const inc = ENTITLEMENTS[tier].keyedMonthly
  if (!inc) return 'n/a'
  if (used >= inc) return 'over100'
  return used >= inc * 0.8 ? 'warn80' : 'ok'
}
