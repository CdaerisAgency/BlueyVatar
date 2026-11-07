/** Marketing prices shown on the home page. Approved by the owner: Pro $9 and Business $49 per month (#67), Plus $9.99 per month. Change them here only, and keep the Stripe prices in step. */
export interface PriceTier {
  id: 'free' | 'plus' | 'pro' | 'business'
  name: string
  /** Monthly price in US dollars. */
  amount: number
  /** Billing period suffix, or null for a free tier. */
  per: 'mo' | null
  highlighted: boolean
}

export const PRICING: readonly PriceTier[] = [
  { id: 'free', name: 'Free', amount: 0, per: null, highlighted: false },
  { id: 'plus', name: 'Plus', amount: 9.99, per: 'mo', highlighted: false },
  { id: 'pro', name: 'Pro', amount: 9, per: 'mo', highlighted: true },
  { id: 'business', name: 'Business', amount: 49, per: 'mo', highlighted: false },
]

/** "$0", "$9", or "$9.99": whole dollars without cents, anything else with two decimals. */
export const formatPrice = (amount: number): string => `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`
