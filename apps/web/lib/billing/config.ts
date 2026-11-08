import type { PaidPlan } from '@blueyvatar/core'

/** Stripe settings, all from the environment and never committed. Everything billing-related no-ops when they are unset. */
export type Env = Record<string, string | undefined>

/** The environment variable that holds each sold plan's Stripe price id. There is no Pro variable: Pro was merged into Plus. */
export const PRICE_ENV: Record<PaidPlan, string> = { plus: 'STRIPE_PRICE_PLUS', business: 'STRIPE_PRICE_BUSINESS' }

const val = (env: Env, name: string): string | undefined => env[name]?.trim() || undefined

/**
 * Price ids set for a plan. Each variable is a comma-separated list: the first id is the price Checkout sells, and any
 * further ids are retired prices (for example the old $9.99 Plus price or the old $9 Pro price) that still map to the
 * same plan, so existing subscribers on them keep working and the webhook never errors on them.
 */
const priceIds = (env: Env, plan: PaidPlan): string[] =>
  (val(env, PRICE_ENV[plan]) ?? '').split(',').map((x) => x.trim()).filter(Boolean)

export const secretKey = (env: Env = process.env) => val(env, 'STRIPE_SECRET_KEY')
export const webhookSecret = (env: Env = process.env) => val(env, 'STRIPE_WEBHOOK_SECRET')
/** The price Checkout and plan switching use for a plan: the first id in its variable. */
export const priceFor = (tier: PaidPlan, env: Env = process.env) => priceIds(env, tier)[0]

/** The paid plan a Stripe price id maps to, or null for a price this deployment does not sell. */
export function tierForPrice(priceId: string, env: Env = process.env): PaidPlan | null {
  if (!priceId) return null
  for (const tier of ['plus', 'business'] as const) if (priceIds(env, tier).includes(priceId)) return tier
  return null
}

export const NOT_CONFIGURED = 'Billing is not configured on this deployment. Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PLUS, and STRIPE_PRICE_BUSINESS (see docs/deploy.md, Stripe billing).'

/** Names of unset variables that Checkout and the portal need. With a plan, only that plan's price is checked. */
export function missingForCheckout(env: Env = process.env, plan?: PaidPlan): string[] {
  const out: string[] = []
  if (!secretKey(env)) out.push('STRIPE_SECRET_KEY')
  for (const t of plan ? [plan] : (['plus', 'business'] as const)) if (!priceFor(t, env)) out.push(PRICE_ENV[t])
  return out
}

/** Names of unset variables the webhook endpoint needs. */
export function missingForWebhook(env: Env = process.env): string[] {
  const out: string[] = []
  if (!webhookSecret(env)) out.push('STRIPE_WEBHOOK_SECRET')
  if (!priceFor('plus', env) && !priceFor('business', env)) out.push('STRIPE_PRICE_PLUS or STRIPE_PRICE_BUSINESS')
  return out
}

/** True when the account page can offer upgrades: both plans have a price. */
export const billingEnabled = (env: Env = process.env): boolean => missingForCheckout(env).length === 0 && !!webhookSecret(env)

/** True when one plan can be bought: Checkout works and that plan's price is set. */
export const planEnabled = (plan: PaidPlan, env: Env = process.env): boolean => missingForCheckout(env, plan).length === 0 && !!webhookSecret(env)
