/** Key expiry choices and date math. Pure, with no imports, so client components can use it. */

export const EXPIRY_CHOICES = ['forever', '30d', '90d', '1y'] as const
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number]
export const DEFAULT_EXPIRY: ExpiryChoice = 'forever'

/** Stored as `api_keys.expires_at`: null is Forever, so no migration is needed beyond 0035. */
export const EXPIRY_LABELS: Record<ExpiryChoice, string> = {
  forever: 'Forever',
  '30d': '30 days',
  '90d': '90 days',
  '1y': '1 year',
}

export function asExpiryChoice(v: unknown): ExpiryChoice | null {
  return typeof v === 'string' && (EXPIRY_CHOICES as readonly string[]).includes(v) ? (v as ExpiryChoice) : null
}

const DAY = 86_400_000

/** Same calendar day one year later in UTC. Feb 29 becomes Feb 28 in a year with no Feb 29. */
export function addOneYear(from: Date): Date {
  const y = from.getUTCFullYear() + 1
  const d = new Date(from.getTime())
  d.setUTCFullYear(y)
  if (d.getUTCMonth() !== from.getUTCMonth()) d.setTime(Date.UTC(y, from.getUTCMonth() + 1, 0, from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()))
  return d
}

/** The instant a key made at `now` stops working, or null for Forever. */
export function expiryFor(choice: ExpiryChoice, now: Date): Date | null {
  if (choice === 'forever') return null
  if (choice === '30d') return new Date(now.getTime() + 30 * DAY)
  if (choice === '90d') return new Date(now.getTime() + 90 * DAY)
  return addOneYear(now)
}

/** The expiry instant itself counts as expired, matching the delivery API. */
export function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime()
}

/** Whole days left, rounded up, never below 0. Null for a Forever key. */
export function daysLeft(expiresAt: Date | null, now: Date): number | null {
  if (expiresAt === null) return null
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY))
}

/** The choice closest to how long a key was meant to last, so a rotated key keeps its lifetime. Forever when it has no expiry. */
export function lifetimeChoice(createdAt: Date, expiresAt: Date | null): ExpiryChoice {
  if (expiresAt === null) return 'forever'
  const days = (expiresAt.getTime() - createdAt.getTime()) / DAY
  return days <= 31 ? '30d' : days <= 91 ? '90d' : '1y'
}
