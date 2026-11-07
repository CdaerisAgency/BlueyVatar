/** Marketing prices shown on the home page. Proposed in #67 and still awaiting sign-off. Change them here only. */
export interface PriceTier {
  id: 'free' | 'pro' | 'business'
  name: string
  amount: number
  /** Billing period suffix, or null for a free tier. */
  per: 'mo' | null
  highlighted: boolean
}

export const PRICING: readonly PriceTier[] = [
  { id: 'free', name: 'Free', amount: 0, per: null, highlighted: false },
  { id: 'pro', name: 'Pro', amount: 9, per: 'mo', highlighted: true },
  { id: 'business', name: 'Business', amount: 49, per: 'mo', highlighted: false },
]
