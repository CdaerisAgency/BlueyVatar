import type { PaidTier } from '@blueyvatar/core'

/** Stripe settings, all from the environment and never committed. Everything billing-related no-ops when they are unset. */
export type Env = Record<string, string | undefined>

export const PRICE_ENV: Record<PaidTier, string> = { pro: 'STRIPE_PRICE_PRO', business: 'STRIPE_PRICE_BUSINESS' }

const val = (env: Env, name: string): string | undefined => env[name]?.trim() || undefined

export const secretKey = (env: Env = process.env) => val(env, 'STRIPE_SECRET_KEY')
export const webhookSecret = (env: Env = process.env) => val(env, 'STRIPE_WEBHOOK_SECRET')
export const priceFor = (tier: PaidTier, env: Env = process.env) => val(env, PRICE_ENV[tier])

/** The paid tier a Stripe price id maps to, or null for a price this deployment does not sell. */
export function tierForPrice(priceId: string, env: Env = process.env): PaidTier | null {
  for (const tier of ['pro', 'business'] as const) if (priceFor(tier, env) === priceId) return tier
  return null
}

export const NOT_CONFIGURED = 'Billing is not configured on this deployment. Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO, and STRIPE_PRICE_BUSINESS (see docs/deploy.md, Stripe billing).'

/** Names of unset variables that Checkout and the portal need for the given plan (all plans when omitted). */
export function missingForCheckout(env: Env = process.env, plan?: PaidTier): string[] {
  const out: string[] = []
  if (!secretKey(env)) out.push('STRIPE_SECRET_KEY')
  for (const t of plan ? [plan] : (['pro', 'business'] as const)) if (!priceFor(t, env)) out.push(PRICE_ENV[t])
  return out
}

/** Names of unset variables the webhook endpoint needs. */
export function missingForWebhook(env: Env = process.env): string[] {
  const out: string[] = []
  if (!webhookSecret(env)) out.push('STRIPE_WEBHOOK_SECRET')
  if (!priceFor('pro', env) && !priceFor('business', env)) out.push('STRIPE_PRICE_PRO or STRIPE_PRICE_BUSINESS')
  return out
}

/** True when the account page can offer upgrades. */
export const billingEnabled = (env: Env = process.env): boolean => missingForCheckout(env).length === 0 && !!webhookSecret(env)
