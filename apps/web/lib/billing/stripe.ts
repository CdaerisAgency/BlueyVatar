import type { PaidPlan } from '@blueyvatar/core'
import Stripe from 'stripe'
import { PRICING } from '../pricing'
import { NOT_CONFIGURED, missingForCheckout, priceFor, secretKey, type Env } from './config'
import type { BillingStore, SubKind, SubscriptionRow } from './store'

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
  client: Pick<Stripe, 'checkout' | 'billingPortal' | 'subscriptions'> | null
  env?: Env
  /** Public origin without a trailing slash, for return URLs. */
  baseUrl: string
}

/** Checkout parameters for a subscription. Stripe Tax computes tax from the address Checkout collects. */
export function checkoutParams(opts: { did: string; licenseId: string; price: string; customer: string | null; baseUrl: string; env?: Env }): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'subscription',
    line_items: [{ price: opts.price, quantity: 1 }],
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    // Shows the promotion code box (https://docs.stripe.com/payments/checkout/discounts). Off unless STRIPE_ALLOW_PROMO_CODES is exactly "true".
    ...((opts.env ?? process.env).STRIPE_ALLOW_PROMO_CODES === 'true' ? { allow_promotion_codes: true } : {}),
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
    checkoutParams({ did, licenseId, price, customer: await ctx.store.customerFor(did), baseUrl: ctx.baseUrl, env }),
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

export type ActionResult = { ok: true; message: string } | { ok: false; error: string }

const PLAN_LABEL: Record<PaidPlan, string> = { plus: 'Plus', pro: 'Pro', business: 'Business' }
const amountOf = (tier: PaidPlan) => PRICING.find((p) => p.id === tier)?.amount ?? 0
const PAYMENT_HELP = 'Your plan was not changed and you were not charged. Check your card under Manage billing, then try again.'

/**
 * Which subscription a plan switch applies to. A person normally holds one. Plus and a developer plan can coexist
 * from before plan switching existed: then a Pro or Business target changes the developer plan, and Plus is already held.
 */
export function subscriptionToSwitch(held: { developer: SubscriptionRow | null; plus: SubscriptionRow | null }, target: PaidPlan): { sub: SubscriptionRow } | { error: string } {
  const { developer, plus } = held
  if (!developer && !plus) return { error: 'You do not have a paid plan yet. Choose a plan to subscribe.' }
  if (target === 'plus') {
    if (plus) return { error: 'You are already on Plus.' }
    return { sub: developer! }
  }
  if (developer) return developer.tier === target ? { error: `You are already on ${PLAN_LABEL[target]}.` } : { sub: developer }
  return { sub: plus! }
}

/**
 * Switches the person's subscription to another plan with subscriptions.update on the existing subscription item
 * (https://docs.stripe.com/billing/subscriptions/upgrade-downgrade). The plan in our database changes only when the
 * resulting customer.subscription.updated webhook arrives.
 *
 * Higher price: proration_behavior always_invoice, which charges the difference now. Lower price: create_prorations,
 * which adds a credit to the next invoice (Stripe does not refund it). payment_behavior error_if_incomplete means a
 * failed charge returns an error and the subscription is not updated.
 */
export async function changePlan(ctx: Ctx, did: string, licenseId: string, target: PaidPlan): Promise<ActionResult> {
  const env = ctx.env ?? process.env
  if (!ctx.client || missingForCheckout(env, target).length > 0) return { ok: false, error: NOT_CONFIGURED }
  const picked = subscriptionToSwitch({ developer: await ctx.store.subscriptionFor(did, 'developer', licenseId), plus: await ctx.store.subscriptionFor(did, 'plus') }, target)
  if ('error' in picked) return { ok: false, error: picked.error }
  const sub = picked.sub
  if (sub.status === 'past_due') return { ok: false, error: 'Your last payment failed. Update your payment method under Manage billing first, then change plans.' }
  if (sub.status !== 'active') return { ok: false, error: 'Your subscription is not active, so the plan cannot be changed here. Use Manage billing.' }
  if (sub.cancelAtPeriodEnd) return { ok: false, error: 'Your subscription is set to end. Resume it first, then change plans.' }
  const price = priceFor(target, env)!
  try {
    const live = await ctx.client.subscriptions.retrieve(sub.id)
    const customer = typeof live.customer === 'string' ? live.customer : live.customer?.id
    if (customer !== sub.customerId) return { ok: false, error: 'This subscription does not belong to your account.' }
    const items = live.items.data
    if (items.length !== 1) return { ok: false, error: 'This subscription has more than one item, so it cannot be switched here. Use Manage billing.' }
    if (items[0]!.price.id === price) return { ok: false, error: `You are already on ${PLAN_LABEL[target]}.` }
    const upgrade = amountOf(target) > amountOf(sub.tier)
    await ctx.client.subscriptions.update(
      sub.id,
      {
        items: [{ id: items[0]!.id, price, quantity: 1 }],
        proration_behavior: upgrade ? 'always_invoice' : 'create_prorations',
        payment_behavior: 'error_if_incomplete',
      },
      // The same click twice within a minute is one change.
      { idempotencyKey: `plan:${sub.id}:${items[0]!.id}:${price}:${Math.floor(Date.now() / 60_000)}` },
    )
  } catch {
    return { ok: false, error: `Stripe could not make that change. ${PAYMENT_HELP}` }
  }
  return { ok: true, message: `Switching to ${PLAN_LABEL[target]}. This page updates when Stripe confirms the change, usually within a minute.` }
}

/**
 * Cancels at the end of the paid period (cancel_at_period_end true) or resumes a canceled subscription (false).
 * Stripe allows resuming any time before the period ends and never after the subscription has ended
 * (https://docs.stripe.com/billing/subscriptions/cancel).
 */
export async function setCancelAtPeriodEnd(ctx: Ctx, did: string, licenseId: string, kind: SubKind, cancel: boolean, now: Date = new Date()): Promise<ActionResult> {
  const env = ctx.env ?? process.env
  if (!ctx.client || !secretKey(env)) return { ok: false, error: NOT_CONFIGURED }
  const sub = await ctx.store.subscriptionFor(did, kind, kind === 'developer' ? licenseId : undefined)
  if (!sub) return { ok: false, error: 'You do not have a subscription to change.' }
  if (cancel && sub.cancelAtPeriodEnd) return { ok: false, error: 'Your subscription is already set to end.' }
  if (!cancel) {
    if (!sub.cancelAtPeriodEnd) return { ok: false, error: 'Your subscription is not set to end.' }
    if (sub.currentPeriodEnd && sub.currentPeriodEnd <= now) return { ok: false, error: 'This subscription has already ended. Choose a plan to subscribe again.' }
  }
  try {
    const live = await ctx.client.subscriptions.retrieve(sub.id)
    const customer = typeof live.customer === 'string' ? live.customer : live.customer?.id
    if (customer !== sub.customerId) return { ok: false, error: 'This subscription does not belong to your account.' }
    await ctx.client.subscriptions.update(sub.id, { cancel_at_period_end: cancel })
  } catch {
    return { ok: false, error: 'Stripe could not make that change. Nothing was changed. Try again in a moment.' }
  }
  return {
    ok: true,
    message: cancel
      ? 'Your subscription will end at the close of the period you paid for. You keep your plan until then.'
      : 'Your subscription will continue and renew as usual.',
  }
}
