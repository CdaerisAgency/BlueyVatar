/**
 * Marketing and billing prices, the only place plan prices are defined. Plus is $9 per month and Business is $49 per month
 * (owner decision; Plus combines the former Plus and Pro plans, and Pro is no longer sold). Change a price here only and
 * keep the Stripe prices in step (docs/deploy.md). Plan limits and features live in packages/core/src/tiers.ts.
 * This file has no imports so client components can use it.
 */
export interface PriceTier {
  id: 'free' | 'plus' | 'business'
  name: string
  /** Monthly price in US dollars. */
  amount: number
  /** Billing period suffix, or null for a free tier. */
  per: 'mo' | null
  highlighted: boolean
}

export const PRICING: readonly PriceTier[] = [
  { id: 'free', name: 'Free', amount: 0, per: null, highlighted: false },
  { id: 'plus', name: 'Plus', amount: 9, per: 'mo', highlighted: true },
  { id: 'business', name: 'Business', amount: 49, per: 'mo', highlighted: false },
]

/** "$0", "$9", or "$9.99": whole dollars without cents, anything else with two decimals. */
export const formatPrice = (amount: number): string => `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`
