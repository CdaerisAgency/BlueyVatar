/**
 * Developer tier entitlements from spec section 11.1.
 * Every number here is a placeholder to validate with cost modeling.
 */
export const TIERS = ['free', 'pro', 'business', 'enterprise'] as const
export type Tier = (typeof TIERS)[number]
export type OutputFormat = 'png' | 'jpeg' | 'webp'

export interface Entitlements {
  maxSize: number
  formats: readonly OutputFormat[]
  ttlControl: boolean
  customDefaultUrl: boolean
  attributionRequired: boolean
  domainRestrictions: boolean
  maxKeys: number | null
  keyedDaily: number | null
  keyedMonthly: number | null
  overage: 'blocked' | 'metered' | 'contract'
  hovercards: boolean
  maxVerifiedAccountsInJson: number | null
}

export const ENTITLEMENTS: Record<Tier, Entitlements> = {
  free: {
    maxSize: 512, formats: ['png'], ttlControl: false, customDefaultUrl: false,
    attributionRequired: true, domainRestrictions: false, maxKeys: 1,
    keyedDaily: 1_000, keyedMonthly: null, overage: 'blocked', hovercards: false,
    maxVerifiedAccountsInJson: 4,
  },
  pro: {
    maxSize: 1024, formats: ['png', 'jpeg', 'webp'], ttlControl: true, customDefaultUrl: true,
    attributionRequired: false, domainRestrictions: true, maxKeys: 5,
    keyedDaily: null, keyedMonthly: 50_000, overage: 'metered', hovercards: false,
    maxVerifiedAccountsInJson: null,
  },
  business: {
    maxSize: 2048, formats: ['png', 'jpeg', 'webp'], ttlControl: true, customDefaultUrl: true,
    attributionRequired: false, domainRestrictions: true, maxKeys: 25,
    keyedDaily: null, keyedMonthly: 1_000_000, overage: 'metered', hovercards: true,
    maxVerifiedAccountsInJson: null,
  },
  enterprise: {
    maxSize: 2048, formats: ['png', 'jpeg', 'webp'], ttlControl: true, customDefaultUrl: true,
    attributionRequired: false, domainRestrictions: true, maxKeys: null,
    keyedDaily: null, keyedMonthly: null, overage: 'contract', hovercards: true,
    maxVerifiedAccountsInJson: null,
  },
}

/** Anonymous requests per day per IP (all tiers except Enterprise contracts). */
export const ANONYMOUS_DAILY_LIMIT = 100
