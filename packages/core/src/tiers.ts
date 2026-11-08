/**
 * Plan entitlements: the one place that defines what each plan's limits and features are (spec sections 11.1 and 11.2).
 * Prices live in apps/web/lib/pricing.ts. Every number here is a placeholder to validate with cost modeling.
 *
 * Plus is the single paid individual plan. It combines the old Plus plan (20 images, gallery, custom profile domain)
 * and the old Pro tier (50,000 requests a month, hovercards, priority cache warming).
 */
export const TIERS = ['free', 'plus', 'business', 'enterprise'] as const
export type Tier = (typeof TIERS)[number]

/** Retired plan names that may still sit in database rows, keys, tokens, or Stripe mirrors. Each resolves to the plan named here. */
export const LEGACY_TIER_ALIASES: Readonly<Record<string, Tier>> = { pro: 'plus' }

/** Resolves a stored plan value to a current tier. A retired name ('pro') becomes Plus. Anything unknown reads as Free. */
export function normalizeTier(value: unknown): Tier {
  if (typeof value !== 'string') return 'free'
  if ((TIERS as readonly string[]).includes(value)) return value as Tier
  return LEGACY_TIER_ALIASES[value] ?? 'free'
}

/**
 * The value written to licenses.tier. Migration 0036 allows 'plus' and renamed old 'pro' rows, so every tier is stored
 * under its own name. 'pro' is still allowed by the constraint and still read as Plus (normalizeTier) until a later cleanup.
 */
export const storedLicenseTier = (tier: Tier): string => tier

export type OutputFormat = 'png' | 'jpeg' | 'webp'

export interface Entitlements {
  maxSize: number
  formats: readonly OutputFormat[]
  ttlControl: boolean
  customDefaultUrl: boolean
  domainRestrictions: boolean
  maxKeys: number | null
  keyedDaily: number | null
  keyedMonthly: number | null
  overage: 'blocked' | 'metered' | 'contract'
  hovercards: boolean
  /** QR code endpoint. Owner decision: available to every plan. The flag stays so the gate can be restored. */
  qrCodes: boolean
  /** Avatar images one account may hold. */
  maxImages: number
  maxVerifiedAccountsInJson: number | null
}

export const ENTITLEMENTS: Record<Tier, Entitlements> = {
  free: {
    maxSize: 512, formats: ['png'], ttlControl: false, customDefaultUrl: false,
    domainRestrictions: false, maxKeys: 1,
    keyedDaily: 1_000, keyedMonthly: null, overage: 'blocked', hovercards: false, qrCodes: true, maxImages: 3,
    maxVerifiedAccountsInJson: 4,
  },
  plus: {
    maxSize: 1024, formats: ['png', 'jpeg', 'webp'], ttlControl: true, customDefaultUrl: true,
    domainRestrictions: true, maxKeys: 5,
    keyedDaily: null, keyedMonthly: 50_000, overage: 'metered', hovercards: true, qrCodes: true, maxImages: 20,
    maxVerifiedAccountsInJson: null,
  },
  business: {
    maxSize: 2048, formats: ['png', 'jpeg', 'webp'], ttlControl: true, customDefaultUrl: true,
    domainRestrictions: true, maxKeys: 25,
    keyedDaily: null, keyedMonthly: 1_000_000, overage: 'metered', hovercards: true, qrCodes: true, maxImages: 20,
    maxVerifiedAccountsInJson: null,
  },
  enterprise: {
    maxSize: 2048, formats: ['png', 'jpeg', 'webp'], ttlControl: true, customDefaultUrl: true,
    domainRestrictions: true, maxKeys: null,
    keyedDaily: null, keyedMonthly: null, overage: 'contract', hovercards: true, qrCodes: true, maxImages: 20,
    maxVerifiedAccountsInJson: null,
  },
}

/** Anonymous requests per day per IP (all tiers except Enterprise contracts). */
export const ANONYMOUS_DAILY_LIMIT = 100

/** Entitlements for any stored plan value, including the retired 'pro' alias. */
export const entitlementsFor = (value: unknown): Entitlements => ENTITLEMENTS[normalizeTier(value)]
