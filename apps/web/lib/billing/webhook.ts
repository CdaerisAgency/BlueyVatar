import { graceEndsAt, isPaidTier, resolveLicenseBilling, type SubscriptionFacts, type SubscriptionStatus } from '@blueyvatar/core'
import { graceExpiredNotice, paymentFailedNotice, subscriptionCanceledNotice, type Notice, type Notifier } from '@blueyvatar/core/verification'
import Stripe from 'stripe'
import { missingForWebhook, tierForPrice, webhookSecret, type Env } from './config'
import type { BillingStore, BillingTx, SubscriptionRow } from './store'
import { log, metrics, reportError } from '../obs'

/** Events the endpoint acts on. Subscribe the Stripe webhook endpoint to exactly these (docs/deploy.md). */
export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
] as const

/** Thrown when an event cannot be applied yet (for example its customer is not linked). The endpoint answers 500 so Stripe retries. */
export class RetryableBillingError extends Error {}

/** A message queued while an event is applied. It is sent only after the event's transaction commits. */
export interface PendingNotice {
  did: string
  notice: Notice
}

export interface WebhookDeps {
  store: BillingStore
  env?: Env
  now?: () => Date
  /** Sends billing notices (spec section 12.1). Omit to send none. */
  notifier?: Pick<Notifier, 'send'>
  publicUrl?: string
}

const DEFAULT_PUBLIC_URL = 'https://blueyvatar.com'
const PLAN_NAME: Record<string, string> = { pro: 'Pro', business: 'Business', plus: 'Plus' }

export interface WebhookResult {
  status: number
  body: { received?: boolean; result?: string; error?: string; message?: string }
}

const STATUSES = new Set<string>(['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'])

type Id = string | { id?: string } | null | undefined
const idOf = (v: Id): string | null => (typeof v === 'string' ? v : (v?.id ?? null))
const isDid = (v: unknown): v is string => typeof v === 'string' && v.startsWith('did:') && v.length < 512

interface SubscriptionObject {
  id: string
  customer: Id
  status: string
  cancel_at_period_end?: boolean
  current_period_end?: number
  metadata?: Record<string, string> | null
  items?: { data?: Array<{ price?: { id?: string }; current_period_end?: number }> }
}
interface SessionObject {
  mode?: string
  customer?: Id
  client_reference_id?: string | null
  metadata?: Record<string, string> | null
}
interface InvoiceObject {
  subscription?: Id
  parent?: { subscription_details?: { subscription?: Id } | null } | null
}

async function recompute(tx: BillingTx, licenseId: string, now: Date) {
  // Plus is a user plan and never changes the license. Only developer-tier subscriptions count here.
  const subs = (await tx.subscriptionsForLicense(licenseId)).filter((s): s is SubscriptionRow & SubscriptionFacts => isPaidTier(s.tier))
  const state = resolveLicenseBilling(subs, now)
  await tx.applyLicense(licenseId, state)
  return state
}

async function onCheckoutCompleted(tx: BillingTx, s: SessionObject): Promise<string> {
  if (s.mode !== 'subscription') return 'ignored: not a subscription checkout'
  const did = s.client_reference_id ?? s.metadata?.did
  const customer = idOf(s.customer)
  if (!isDid(did) || !customer) return 'ignored: no DID or customer on the session'
  const owner = await tx.didForCustomer(customer)
  if (owner && owner !== did) return 'ignored: customer already linked to another DID'
  const license = await tx.ensureLicense(did)
  await tx.linkCustomer(did, license.licenseId, customer)
  return 'customer linked'
}

async function onSubscription(tx: BillingTx, type: string, sub: SubscriptionObject, at: Date, now: Date, env: Env, out: PendingNotice[], publicUrl: string): Promise<string> {
  const priceId = sub.items?.data?.[0]?.price?.id
  const tier = priceId ? tierForPrice(priceId, env) : null
  if (!priceId || !tier) return 'ignored: price is not one this deployment sells'
  const customer = idOf(sub.customer)
  if (!customer) return 'ignored: no customer'
  const did = isDid(sub.metadata?.did) ? sub.metadata!.did! : await tx.didForCustomer(customer)
  if (!did) throw new RetryableBillingError(`customer ${customer} is not linked to a DID yet`)

  const existing = await tx.getSubscription(sub.id)
  if (existing && existing.did !== did) return 'ignored: subscription belongs to another DID'
  if (existing && at < existing.lastEventAt) return 'ignored: older than the stored state'

  const status: SubscriptionStatus = type === 'customer.subscription.deleted' ? 'canceled' : STATUSES.has(sub.status) ? (sub.status as SubscriptionStatus) : 'incomplete'
  const ends = (sub.items?.data ?? []).map((i) => i.current_period_end).filter((n): n is number => typeof n === 'number')
  const periodEnd = ends.length > 0 ? Math.max(...ends) : sub.current_period_end
  const license = await tx.ensureLicense(did)
  await tx.linkCustomer(did, license.licenseId, customer)
  const row: SubscriptionRow = {
    id: sub.id,
    customerId: customer,
    did,
    licenseId: license.licenseId,
    priceId,
    tier,
    status,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    // The grace period starts when the subscription first goes past due and keeps its start while it stays past due.
    pastDueSince: status === 'past_due' ? (existing?.pastDueSince ?? at) : null,
    lastEventAt: at,
  }
  await tx.putSubscription(row)
  const state = await recompute(tx, license.licenseId, now)
  // Tell the owner once, on the transition into an ending state. A subscription that was already past due and is
  // now over means the grace period ran out; Plus ends the same way but has no license tier to drop.
  const ended = status === 'canceled' || status === 'unpaid'
  const wasLive = existing ? ['active', 'trialing', 'past_due'].includes(existing.status) : false
  if (ended && wasLive) {
    const plan = PLAN_NAME[tier] ?? tier
    const dropped = tier === 'plus' || state.tier === 'free'
    out.push({
      did,
      notice:
        existing!.status === 'past_due' && dropped
          ? graceExpiredNotice({ did, plan, publicUrl })
          : subscriptionCanceledNotice({ did, plan, publicUrl }),
    })
  }
  return `subscription ${status}, tier ${tier}`
}

async function onPaymentFailed(tx: BillingTx, inv: InvoiceObject, at: Date, now: Date, out: PendingNotice[], publicUrl: string): Promise<string> {
  const id = idOf(inv.subscription) ?? idOf(inv.parent?.subscription_details?.subscription)
  if (!id) return 'ignored: invoice has no subscription'
  const existing = await tx.getSubscription(id)
  // A first payment that fails leaves the subscription incomplete, and nothing is entitled yet.
  if (!existing || !['active', 'trialing', 'past_due'].includes(existing.status)) return 'ignored: subscription is not entitled'
  if (at < existing.lastEventAt) return 'ignored: older than the stored state'
  const pastDueSince = existing.pastDueSince ?? at
  await tx.putSubscription({ ...existing, status: 'past_due', pastDueSince, lastEventAt: at })
  await recompute(tx, existing.licenseId, now)
  // Stripe retries a failed invoice; only the first failure starts the grace period and gets a message.
  if (existing.status !== 'past_due') out.push({ did: existing.did, notice: paymentFailedNotice({ did: existing.did, graceEnds: graceEndsAt(pastDueSince), publicUrl }) })
  return 'marked past due'
}

/** Applies one verified event. Returns a short description for logs. */
export async function applyEvent(tx: BillingTx, event: Stripe.Event, now: Date, env: Env, out: PendingNotice[] = [], publicUrl = DEFAULT_PUBLIC_URL): Promise<string> {
  const at = new Date(event.created * 1000)
  switch (event.type) {
    case 'checkout.session.completed':
      return onCheckoutCompleted(tx, event.data.object as unknown as SessionObject)
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return onSubscription(tx, event.type, event.data.object as unknown as SubscriptionObject, at, now, env, out, publicUrl)
    case 'invoice.payment_failed':
      return onPaymentFailed(tx, event.data.object as unknown as InvoiceObject, at, now, out, publicUrl)
    default:
      return 'ignored: event type not handled'
  }
}

/**
 * The webhook endpoint's logic. `rawBody` must be the exact bytes Stripe sent, as text: the signature covers the raw body,
 * so parsing and re-serializing it first would break verification.
 */
export async function handleStripeWebhook(rawBody: string, signature: string | null, deps: WebhookDeps): Promise<WebhookResult> {
  const env = deps.env ?? process.env
  const missing = missingForWebhook(env)
  if (missing.length > 0) {
    return { status: 503, body: { error: 'stripe_not_configured', message: `Billing webhook is disabled: ${missing.join(', ')} not set.` } }
  }
  if (!signature) return { status: 400, body: { error: 'missing_signature', message: 'Missing stripe-signature header.' } }
  let event: Stripe.Event
  try {
    event = Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret(env)!)
  } catch {
    metrics.inc('web_stripe_webhook_total', { result: 'bad_signature' })
    log.warn('stripe webhook signature rejected')
    return { status: 400, body: { error: 'invalid_signature', message: 'Signature verification failed.' } }
  }
  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) return { status: 200, body: { received: true, result: 'ignored: event type not handled' } }
  const now = (deps.now ?? (() => new Date()))()
  try {
    let result = 'duplicate'
    const pending: PendingNotice[] = []
    const publicUrl = deps.publicUrl ?? env.PUBLIC_URL ?? DEFAULT_PUBLIC_URL
    const outcome = await deps.store.process(event.id, event.type, async (tx) => {
      pending.length = 0 // a transaction that is retried must not queue its messages twice
      result = await applyEvent(tx, event, now, env, pending, publicUrl)
    })
    if (outcome === 'duplicate') result = 'duplicate: already processed'
    // Only the delivery that recorded the event id sends mail, so Stripe redelivery cannot mail twice.
    // The notifier never throws, and a failed message never fails the webhook.
    else if (deps.notifier) for (const p of pending) await deps.notifier.send(p.did, 'billing', p.notice)
    metrics.inc('web_stripe_webhook_total', { result: 'ok' })
    log.info('stripe webhook', { eventId: event.id, type: event.type, result })
    return { status: 200, body: { received: true, result } }
  } catch (err) {
    metrics.inc('web_stripe_webhook_total', { result: 'failed' })
    reportError('stripe webhook failed', err, { tags: { stripe_event_type: event.type }, extra: { eventId: event.id } })
    return { status: 500, body: { error: 'processing_failed', message: 'Event could not be applied. Stripe will retry.' } }
  }
}
