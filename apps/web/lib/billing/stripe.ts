import type { PaidPlan } from '@blueyvatar/core'
import Stripe from 'stripe'
import { NOT_CONFIGURED, missingForCheckout, priceFor, secretKey, type Env } from './config'
import type { BillingStore } from './store'

const g = globalThis as { __bvStripe?: { key: string; client: Stripe } }

/** The Stripe client, or null when STRIPE_SECRET_KEY is unset. The API version is the one pinned by the stripe package. */
export function stripeClient(env: Env = process.env): Stripe | null {
  const key = secretKey(env)
  if (!key) return null
  if (g.__bvStripe?.key !== key) g.__bvStripe = { key, client: new Stripe(key, { maxNetworkRetries: 2, appInfo: { name: 'blueyvatar' } }) }
  return g.__bvStripe.client
}

export type UrlResult = { ok: true; url: string } | { ok: false; error: string }

interface Ctx {
  store: BillingStore
  client: Pick<Stripe, 'checkout' | 'billingPortal'> | null
  env?: Env
  /** Public origin without a trailing slash, for return URLs. */
  baseUrl: string
}

/** Checkout parameters for a subscription. Stripe Tax computes tax from the address Checkout collects. */
export function checkoutParams(opts: { did: string; licenseId: string; price: string; customer: string | null; baseUrl: string }): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'subscription',
    line_items: [{ price: opts.price, quantity: 1 }],
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    client_reference_id: opts.did,
    metadata: { did: opts.did },
    subscription_data: { metadata: { did: opts.did, license_id: opts.licenseId } },
    // An existing customer needs these so Checkout can save the address Stripe Tax uses.
    ...(opts.customer ? { customer: opts.customer, customer_update: { address: 'auto', name: 'auto' } } : {}),
    success_url: `${opts.baseUrl}/account/billing?checkout=success`,
    cancel_url: `${opts.baseUrl}/account/billing?checkout=canceled`,
  }
}

export async function createCheckoutUrl(ctx: Ctx, did: string, licenseId: string, tier: PaidPlan): Promise<UrlResult> {
  const env = ctx.env ?? process.env
  if (!ctx.client || missingForCheckout(env, tier).length > 0) return { ok: false, error: NOT_CONFIGURED }
  const price = priceFor(tier, env)!
  // A user can hold one developer subscription and one Plus subscription, never two of the same kind.
  // Developer subscriptions are per license, so an organization license has its own.
  const current = await ctx.store.subscriptionFor(did, tier === 'plus' ? 'plus' : 'developer', tier === 'plus' ? undefined : licenseId)
  if (current) return { ok: false, error: 'You already have a subscription. Use Manage billing to change or cancel it.' }
  const session = await ctx.client.checkout.sessions.create(
    checkoutParams({ did, licenseId, price, customer: await ctx.store.customerFor(did), baseUrl: ctx.baseUrl }),
  )
  return session.url ? { ok: true, url: session.url } : { ok: false, error: 'Stripe did not return a Checkout URL. Try again.' }
}

export async function createPortalUrl(ctx: Ctx, did: string): Promise<UrlResult> {
  const env = ctx.env ?? process.env
  if (!ctx.client || !secretKey(env)) return { ok: false, error: NOT_CONFIGURED }
  const customer = await ctx.store.customerFor(did)
  if (!customer) return { ok: false, error: 'No billing account exists for this sign-in yet. Subscribe to a plan first.' }
  const session = await ctx.client.billingPortal.sessions.create({ customer, return_url: `${ctx.baseUrl}/account/billing` })
  return { ok: true, url: session.url }
}
