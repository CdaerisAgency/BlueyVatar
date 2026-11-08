import type { PaidPlan } from '@blueyvatar/core'
import { PRICING, formatPrice } from '../pricing'

/** The fields of a subscription row that the Billing page shows. */
export interface SubscriptionView {
  tier: 'plus' | 'business'
  status: string
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

export interface PlanSummary {
  /** "Plus" */
  plan: string
  /** "$9 per month" */
  price: string
  /** "Active", "In trial", or "Payment failed" */
  status: string
  /** "Renews on November 30, 2026", "Ends on November 30, 2026 (you keep Plus until then)", or null when Stripe gave no date. */
  when: string | null
  /** "Your plan changes to Plus on November 30, 2026" while a downgrade waits for the period to end, else null. */
  change: string | null
}

const STATUS_TEXT: Record<string, string> = {
  active: 'Active',
  trialing: 'In trial',
  past_due: 'Payment failed',
}

/** "November 30, 2026", always in UTC so the server and the reader see the same day. */
export const longDate = (d: Date): string => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

/** Plain-English facts about one subscription, for the Billing page. */
export function summarize(sub: SubscriptionView, pending?: { tier: 'plus' | 'business'; at: Date } | null): PlanSummary {
  const tier = PRICING.find((p) => p.id === sub.tier)!
  const date = sub.currentPeriodEnd ? longDate(sub.currentPeriodEnd) : null
  const next = pending ? PRICING.find((p) => p.id === pending.tier) : null
  return {
    change: pending && next ? `Your plan changes to ${next.name} on ${longDate(pending.at)}` : null,
    plan: tier.name,
    price: `${formatPrice(tier.amount)} per month`,
    status: STATUS_TEXT[sub.status] ?? sub.status.replace(/_/g, ' '),
    when: date ? (sub.cancelAtPeriodEnd ? `Ends on ${date} (you keep ${tier.name} until then)` : `Renews on ${date}`) : sub.cancelAtPeriodEnd ? 'Ends at the close of the current period' : null,
  }
}
