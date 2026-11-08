import { normalizeTier, type Tier } from './tiers.js'

/**
 * How long a past-due license keeps its paid tier before dropping to Free limits (spec section 12).
 * PROPOSAL for the owner: 7 days. Stripe's own retry schedule (Smart Retries, configured in the dashboard) should
 * finish inside this window. Change it here only; delivery, web, and the webhook all read this constant.
 */
export const PAST_DUE_GRACE_DAYS = 7
export const PAST_DUE_GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000

/**
 * Plans sold through Stripe Checkout: Plus ($9 per month) and Business ($49 per month). Enterprise is a contract and
 * never self-serve. Pro is retired: a stored 'pro' resolves to Plus (see normalizePaidPlan).
 */
export const PAID_TIERS = ['plus', 'business'] as const satisfies readonly Tier[]
export type PaidTier = (typeof PAID_TIERS)[number]
export const PLUS_PLAN = 'plus' as const
/** Everything a Stripe price can map to. */
export const PAID_PLANS = PAID_TIERS
export type PaidPlan = PaidTier
export const isPaidTier = (v: unknown): v is PaidTier => (PAID_TIERS as readonly unknown[]).includes(v)

/** A stored subscription plan value as a sellable plan: 'pro' (retired) becomes Plus, unknown values give null. */
export function normalizePaidPlan(v: unknown): PaidPlan | null {
  const t = typeof v === 'string' ? normalizeTier(v) : 'free'
  return isPaidTier(t) ? t : null
}

const RANK: Record<Tier, number> = { free: 0, plus: 1, business: 2, enterprise: 3 }

/** The Stripe subscription statuses, as sent in webhook payloads. */
export type SubscriptionStatus =
  | 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused'

/** What billing knows about one subscription. `tier` is the tier its price maps to. */
export interface SubscriptionFacts {
  /** A plan value as stored. The retired 'pro' reads as Plus. */
  tier: PaidTier | 'pro'
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

/**
 * Whether any subscription still entitles the user plan Plus at `now`. Plus, Business (which includes everything in
 * Plus), and the retired 'pro' name all count. Same status and grace rules as the license tiers.
 */
export function plusEntitled(subs: readonly { tier: string; status: SubscriptionStatus; pastDueSince: Date | null }[], now: Date): boolean {
  return subs.some((s) => normalizePaidPlan(s.tier) !== null && entitles({ tier: 'plus', status: s.status, pastDueSince: s.pastDueSince }, now))
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
  let best: (SubscriptionFacts & { tier: PaidTier }) | null = null
  for (const raw of subs) {
    const s = { ...raw, tier: normalizePaidPlan(raw.tier) ?? 'plus' }
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
export function effectiveTier(license: { tier: Tier | string; status: string; graceEndsAt?: Date | null }, now: Date): Tier {
  const tier = normalizeTier(license.tier)
  if (tier === 'enterprise') return 'enterprise'
  if (license.status === 'past_due' && license.graceEndsAt && now >= license.graceEndsAt) return 'free'
  return tier
}
