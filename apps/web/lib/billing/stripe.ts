import type { PaidPlan } from '@blueyvatar/core'
import Stripe from 'stripe'
import { PRICING } from '../pricing'
import { NOT_CONFIGURED, missingForCheckout, priceFor, secretKey, type Env } from './config'
import { pendingChangeOf, priceIdOf, type PendingChange, type ScheduleLike } from './schedule'
import { longDate } from './summary'
import type { BillingStore, SubscriptionRow } from './store'

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
  client: Pick<Stripe, 'checkout' | 'billingPortal' | 'subscriptions' | 'subscriptionSchedules'> | null
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
  // One subscription per license. An organization license has its own, so it does not block the owner's personal plan.
  const current = await ctx.store.subscriptionFor(did, licenseId)
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

const PLAN_LABEL: Record<PaidPlan, string> = { plus: 'Plus', business: 'Business' }
const amountOf = (tier: PaidPlan) => PRICING.find((p) => p.id === tier)?.amount ?? 0
const PAYMENT_HELP = 'Your plan was not changed and you were not charged. Check your card under Manage billing, then try again.'

/** Which subscription a plan switch applies to, or why none can be switched. Only Plus and Business are offered. */
export function subscriptionToSwitch(held: SubscriptionRow | null, target: PaidPlan): { sub: SubscriptionRow } | { error: string } {
  if (!held) return { error: 'You do not have a paid plan yet. Choose a plan to subscribe.' }
  if (held.tier === target) return { error: `You are already on ${PLAN_LABEL[target]}.` }
  return { sub: held }
}

type Live = { customer?: string | { id?: string } | null; items: { data: Array<{ id: string; price: { id: string }; quantity?: number | null }> }; schedule?: string | ScheduleLike | null }
type Client = NonNullable<Ctx['client']>

/** The live subscription with its schedule, checked to belong to this person. Throws on a Stripe error. */
async function liveSubscription(client: Client, sub: SubscriptionRow): Promise<{ live: Live; schedule: ScheduleLike | null } | { error: string }> {
  const live = (await client.subscriptions.retrieve(sub.id, { expand: ['schedule'] })) as unknown as Live
  const customer = typeof live.customer === 'string' ? live.customer : live.customer?.id
  if (customer !== sub.customerId) return { error: 'This subscription does not belong to your account.' }
  const s = live.schedule
  const schedule = !s ? null : typeof s === 'string' ? ((await client.subscriptionSchedules.retrieve(s)) as unknown as ScheduleLike) : s
  return { live, schedule }
}

/**
 * The downgrade waiting for the period to end, or null. Read from Stripe, which is the source of truth for the schedule, so
 * the Billing page shows it after a reload and no table holds a copy that could drift. Never throws: on any error the
 * page simply shows no pending change.
 */
export async function getPendingChange(ctx: Ctx, sub: SubscriptionRow, now: Date = new Date()): Promise<PendingChange | null> {
  if (!ctx.client || !secretKey(ctx.env ?? process.env) || sub.tier !== 'business') return null
  try {
    const r = await liveSubscription(ctx.client, sub)
    return 'error' in r ? null : pendingChangeOf(r.schedule, ctx.env ?? process.env, now)
  } catch {
    return null
  }
}

/** Releases a schedule: the subscription stays exactly as it is now and the later phases are dropped (https://docs.stripe.com/api/subscription_schedules/release). */
const release = (client: Client, id: string) => client.subscriptionSchedules.release(id)

/**
 * Switches the person's subscription to another plan.
 *
 * Higher price (Plus to Business): subscriptions.update on the existing item with always_invoice, which charges the
 * difference now (https://docs.stripe.com/billing/subscriptions/upgrade-downgrade). payment_behavior error_if_incomplete
 * means a failed charge returns an error and the subscription is not updated.
 *
 * Lower price (Business to Plus): a subscription schedule. from_subscription makes a schedule with one phase that matches
 * the current period, then a second phase with the Plus price starts when the period ends, with proration_behavior none
 * so there is no credit and no refund (https://docs.stripe.com/billing/subscriptions/subscription-schedules/use-cases,
 * "Schedule an upgrade or downgrade for an existing subscription"). Nothing is charged or changed today.
 *
 * Asking for the plan you hold while a downgrade is pending cancels the schedule (keep Business).
 * The plan in our database changes only when Stripe's webhook reports the phase change or a direct update.
 */
export async function changePlan(ctx: Ctx, did: string, licenseId: string, target: PaidPlan, now: Date = new Date()): Promise<ActionResult> {
  const env = ctx.env ?? process.env
  if (!ctx.client || missingForCheckout(env, target).length > 0) return { ok: false, error: NOT_CONFIGURED }
  const held = await ctx.store.subscriptionFor(did, licenseId)
  if (held && held.tier === target) return keepCurrentPlan(ctx, ctx.client, held, now)
  const picked = subscriptionToSwitch(held, target)
  if ('error' in picked) return { ok: false, error: picked.error }
  const sub = picked.sub
  if (sub.status === 'past_due') return { ok: false, error: 'Your last payment failed. Update your payment method under Manage billing first, then change plans.' }
  if (sub.status !== 'active') return { ok: false, error: 'Your subscription is not active, so the plan cannot be changed here. Use Manage billing.' }
  if (sub.cancelAtPeriodEnd) return { ok: false, error: 'Your subscription is set to end. Resume it first, then change plans.' }
  const price = priceFor(target, env)!
  const upgrade = amountOf(target) > amountOf(sub.tier)
  try {
    const r = await liveSubscription(ctx.client, sub)
    if ('error' in r) return { ok: false, error: r.error }
    const { live, schedule } = r
    const items = live.items.data
    if (items.length !== 1) return { ok: false, error: 'This subscription has more than one item, so it cannot be switched here. Use Manage billing.' }
    if (items[0]!.price.id === price) return { ok: false, error: `You are already on ${PLAN_LABEL[target]}.` }
    if (!upgrade) return await scheduleDowngrade(ctx.client, sub, schedule, target, price, env, now)
    // Stripe says to change a subscription with an attached schedule through the schedule API, and that a direct update may
    // be overwritten at the next phase. What a direct item change does to one is Unknown, so an upgrade waits until it is canceled.
    if (schedule) return { ok: false, error: 'A plan change is already scheduled. Cancel the scheduled change first, then upgrade.' }
    await ctx.client.subscriptions.update(
      sub.id,
      {
        items: [{ id: items[0]!.id, price, quantity: 1 }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
      },
      // The same click twice within a minute is one change.
      { idempotencyKey: `plan:${sub.id}:${items[0]!.id}:${price}:${Math.floor(now.getTime() / 60_000)}` },
    )
  } catch {
    return { ok: false, error: `Stripe could not make that change. ${PAYMENT_HELP}` }
  }
  return { ok: true, message: `Switching to ${PLAN_LABEL[target]}. This page updates when Stripe confirms the change, usually within a minute.` }
}

async function scheduleDowngrade(client: Client, sub: SubscriptionRow, schedule: ScheduleLike | null, target: PaidPlan, price: string, env: Env, now: Date): Promise<ActionResult> {
  const label = PLAN_LABEL[target]
  if (schedule) {
    const pending = pendingChangeOf(schedule, env, now)
    if (pending?.tier === target) return { ok: true, message: `Your plan already changes to ${label} on ${longDate(pending.at)}.` }
    // A schedule we did not make (for example from the Stripe Dashboard) is left alone.
    return { ok: false, error: 'A plan change is already scheduled in Stripe. Use Manage billing to review it.' }
  }
  const stop = { ok: false, error: `Stripe could not schedule that change. Your plan was not changed and you were not charged.` } as const
  let created: ScheduleLike | null = null
  try {
    created = (await client.subscriptionSchedules.create({ from_subscription: sub.id }, { idempotencyKey: `sched:${sub.id}:${Math.floor(now.getTime() / 60_000)}` })) as unknown as ScheduleLike
    const p0 = created.phases?.[0]
    const item = p0?.items?.[0]
    const current = priceIdOf(item?.price)
    // Stripe unsets any phase setting we leave out of the update, so a phase with settings we do not copy is not touched.
    if (!p0 || !item || p0.items!.length !== 1 || !current || !p0.start_date || !p0.end_date || p0.discounts?.length || p0.add_invoice_items?.length || p0.trial_end) {
      await release(client, created.id)
      return { ok: false, error: 'This subscription has settings that cannot be scheduled here. Use Manage billing.' }
    }
    const shared = {
      ...(p0.metadata && Object.keys(p0.metadata).length > 0 ? { metadata: p0.metadata } : {}),
      ...(p0.automatic_tax && typeof p0.automatic_tax.enabled === 'boolean' ? { automatic_tax: { enabled: p0.automatic_tax.enabled } } : {}),
    }
    await client.subscriptionSchedules.update(
      created.id,
      {
        end_behavior: 'release',
        // The current phase is unchanged, so the update creates nothing. The later phase has none: no credit, no refund.
        proration_behavior: 'none',
        phases: [
          { items: [{ price: current, quantity: item.quantity ?? 1 }], start_date: p0.start_date, end_date: p0.end_date, ...shared },
          { items: [{ price, quantity: 1 }], duration: { interval: 'month', interval_count: 1 }, proration_behavior: 'none', ...shared },
        ],
      },
      { idempotencyKey: `sched-set:${created.id}` },
    )
    return { ok: true, message: `Your plan changes to ${label} on ${longDate(new Date(p0.end_date * 1000))}. You keep ${PLAN_LABEL[sub.tier]} until then, and nothing is charged or credited.` }
  } catch {
    // Do not leave a schedule with no change behind.
    if (created) await release(client, created.id).catch(() => {})
    return stop
  }
}

async function keepCurrentPlan(ctx: Ctx, client: Client, sub: SubscriptionRow, now: Date): Promise<ActionResult> {
  const env = ctx.env ?? process.env
  try {
    const r = await liveSubscription(client, sub)
    if ('error' in r) return { ok: false, error: r.error }
    const pending = pendingChangeOf(r.schedule, env, now)
    if (!pending) return { ok: false, error: `You are already on ${PLAN_LABEL[sub.tier]}.` }
    await release(client, pending.scheduleId)
  } catch {
    return { ok: false, error: 'Stripe could not make that change. Nothing was changed. Try again in a moment.' }
  }
  return { ok: true, message: `The scheduled change is canceled. You stay on ${PLAN_LABEL[sub.tier]} and renew as usual.` }
}

/** Cancels a pending downgrade so the person keeps their plan. */
export async function cancelScheduledChange(ctx: Ctx, did: string, licenseId: string, now: Date = new Date()): Promise<ActionResult> {
  const env = ctx.env ?? process.env
  if (!ctx.client || !secretKey(env)) return { ok: false, error: NOT_CONFIGURED }
  const sub = await ctx.store.subscriptionFor(did, licenseId)
  if (!sub) return { ok: false, error: 'You do not have a subscription to change.' }
  const r = await keepCurrentPlan(ctx, ctx.client, sub, now)
  return r.ok || !r.error.startsWith('You are already on') ? r : { ok: false, error: 'You have no scheduled plan change.' }
}

/**
 * Cancels at the end of the paid period (cancel_at_period_end true) or resumes a canceled subscription (false).
 * Stripe allows resuming any time before the period ends and never after the subscription has ended
 * (https://docs.stripe.com/billing/subscriptions/cancel).
 */
export async function setCancelAtPeriodEnd(ctx: Ctx, did: string, licenseId: string, cancel: boolean, now: Date = new Date()): Promise<ActionResult> {
  const env = ctx.env ?? process.env
  if (!ctx.client || !secretKey(env)) return { ok: false, error: NOT_CONFIGURED }
  const sub = await ctx.store.subscriptionFor(did, licenseId)
  if (!sub) return { ok: false, error: 'You do not have a subscription to change.' }
  if (cancel && sub.cancelAtPeriodEnd) return { ok: false, error: 'Your subscription is already set to end.' }
  if (!cancel) {
    if (!sub.cancelAtPeriodEnd) return { ok: false, error: 'Your subscription is not set to end.' }
    if (sub.currentPeriodEnd && sub.currentPeriodEnd <= now) return { ok: false, error: 'This subscription has already ended. Choose a plan to subscribe again.' }
  }
  let released = false
  try {
    const r = await liveSubscription(ctx.client, sub)
    if ('error' in r) return { ok: false, error: r.error }
    // Ending the subscription replaces a pending downgrade: the schedule is released first so the two cannot disagree.
    // What cancel_at_period_end does on a subscription that still has a schedule is Unknown in Stripe's docs, so it is never set while one is attached.
    if (cancel && r.schedule) {
      await release(ctx.client, r.schedule.id)
      released = true
    }
    await ctx.client.subscriptions.update(sub.id, { cancel_at_period_end: cancel })
  } catch {
    if (released) return { ok: false, error: 'Your scheduled plan change was canceled, but the subscription was not set to end. You are still on your current plan. Try again.' }
    return { ok: false, error: 'Stripe could not make that change. Nothing was changed. Try again in a moment.' }
  }
  return {
    ok: true,
    message: cancel
      ? 'Your subscription will end at the close of the period you paid for. You keep your plan until then.'
      : 'Your subscription will continue and renew as usual.',
  }
}
