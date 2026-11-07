import type { Tier } from './tiers.js'

/**
 * How long a past-due license keeps its paid tier before dropping to Free limits (spec section 12).
 * PROPOSAL for the owner: 7 days. Stripe's own retry schedule (Smart Retries, configured in the dashboard) should
 * finish inside this window. Change it here only; delivery, web, and the webhook all read this constant.
 */
export const PAST_DUE_GRACE_DAYS = 7
export const PAST_DUE_GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000

/** Paid developer tiers sold through Stripe Checkout. Enterprise is a contract and never self-serve. */
export const PAID_TIERS = ['pro', 'business'] as const satisfies readonly Tier[]
export type PaidTier = (typeof PAID_TIERS)[number]

/**
 * Plus is the paid user plan (spec section 11.2, $9.99 per month). It is sold through the same Stripe Checkout and
 * webhook as the developer tiers but is not a developer tier: it never changes a license, only the user's plan.
 */
export const PLUS_PLAN = 'plus' as const
/** Everything a Stripe price can map to. */
export const PAID_PLANS = [...PAID_TIERS, PLUS_PLAN] as const
export type PaidPlan = (typeof PAID_PLANS)[number]
export const isPaidTier = (v: unknown): v is PaidTier => (PAID_TIERS as readonly unknown[]).includes(v)

const RANK: Record<Tier, number> = { free: 0, pro: 1, business: 2, enterprise: 3 }

/** The Stripe subscription statuses, as sent in webhook payloads. */
export type SubscriptionStatus =
  | 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused'

/** What billing knows about one subscription. `tier` is the tier its price maps to. */
export interface SubscriptionFacts {
  tier: PaidTier
  status: SubscriptionStatus
  /** When the subscription first went past due, or null. Starts the grace period. */
  pastDueSince: Date | null
}

export function graceEndsAt(pastDueSince: Date): Date {
  return new Date(pastDueSince.getTime() + PAST_DUE_GRACE_MS)
}

/** Whether a subscription still entitles its tier at `now`. Active and trialing always do; past due does inside the grace period. */
export function entitles(sub: SubscriptionFacts, now: Date): boolean {
  if (sub.status === 'active' || sub.status === 'trialing') return true
  if (sub.status === 'past_due') return sub.pastDueSince !== null && now < graceEndsAt(sub.pastDueSince)
  return false
}

/** Whether any Plus subscription still entitles the user's Plus plan at `now`. Same status and grace rules as the developer tiers. */
export function plusEntitled(subs: readonly { tier: string; status: SubscriptionStatus; pastDueSince: Date | null }[], now: Date): boolean {
  return subs.some((s) => s.tier === PLUS_PLAN && entitles({ tier: 'pro', status: s.status, pastDueSince: s.pastDueSince }, now))
}

export interface LicenseBilling {
  tier: Tier
  status: 'active' | 'past_due'
  /** Set while any entitling subscription is past due. After this instant the license reads as Free. */
  graceEndsAt: Date | null
}

/**
 * Derives the license tier from all of a license's subscriptions. The highest entitling tier wins.
 * With no entitling subscription the result is Free (a downgrade changes limits only, spec section 12).
 * A license is `past_due` only while its winning subscription is past due.
 */
export function resolveLicenseBilling(subs: readonly SubscriptionFacts[], now: Date): LicenseBilling {
  let best: SubscriptionFacts | null = null
  for (const s of subs) {
    if (!entitles(s, now)) continue
    if (!best || RANK[s.tier] > RANK[best.tier] || (RANK[s.tier] === RANK[best.tier] && s.status !== 'past_due' && best.status === 'past_due')) best = s
  }
  if (!best) return { tier: 'free', status: 'active', graceEndsAt: null }
  if (best.status === 'past_due') return { tier: best.tier, status: 'past_due', graceEndsAt: graceEndsAt(best.pastDueSince!) }
  return { tier: best.tier, status: 'active', graceEndsAt: null }
}

/**
 * The tier a request is served at. A past-due license keeps its tier until `graceEndsAt`, then reads as Free
 * with no further webhook needed, so a missed event cannot extend paid limits. Enterprise is never touched.
 */
export function effectiveTier(license: { tier: Tier; status: string; graceEndsAt?: Date | null }, now: Date): Tier {
  if (license.tier === 'enterprise') return 'enterprise'
  if (license.status === 'past_due' && license.graceEndsAt && now >= license.graceEndsAt) return 'free'
  return license.tier
}
