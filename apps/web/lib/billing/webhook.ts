import { isPaidTier, resolveLicenseBilling, type SubscriptionFacts, type SubscriptionStatus } from '@blueyvatar/core'
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

export interface WebhookDeps {
  store: BillingStore
  env?: Env
  now?: () => Date
}

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

async function recompute(tx: BillingTx, licenseId: string, now: Date): Promise<void> {
  // Plus is a user plan and never changes the license. Only developer-tier subscriptions count here.
  const subs = (await tx.subscriptionsForLicense(licenseId)).filter((s): s is SubscriptionRow & SubscriptionFacts => isPaidTier(s.tier))
  await tx.applyLicense(licenseId, resolveLicenseBilling(subs, now))
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

async function onSubscription(tx: BillingTx, type: string, sub: SubscriptionObject, at: Date, now: Date, env: Env): Promise<string> {
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
  await recompute(tx, license.licenseId, now)
  return `subscription ${status}, tier ${tier}`
}

async function onPaymentFailed(tx: BillingTx, inv: InvoiceObject, at: Date, now: Date): Promise<string> {
  const id = idOf(inv.subscription) ?? idOf(inv.parent?.subscription_details?.subscription)
  if (!id) return 'ignored: invoice has no subscription'
  const existing = await tx.getSubscription(id)
  // A first payment that fails leaves the subscription incomplete, and nothing is entitled yet.
  if (!existing || !['active', 'trialing', 'past_due'].includes(existing.status)) return 'ignored: subscription is not entitled'
  if (at < existing.lastEventAt) return 'ignored: older than the stored state'
  await tx.putSubscription({ ...existing, status: 'past_due', pastDueSince: existing.pastDueSince ?? at, lastEventAt: at })
  await recompute(tx, existing.licenseId, now)
  return 'marked past due'
}

/** Applies one verified event. Returns a short description for logs. */
export async function applyEvent(tx: BillingTx, event: Stripe.Event, now: Date, env: Env): Promise<string> {
  const at = new Date(event.created * 1000)
  switch (event.type) {
    case 'checkout.session.completed':
      return onCheckoutCompleted(tx, event.data.object as unknown as SessionObject)
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return onSubscription(tx, event.type, event.data.object as unknown as SubscriptionObject, at, now, env)
    case 'invoice.payment_failed':
      return onPaymentFailed(tx, event.data.object as unknown as InvoiceObject, at, now)
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
    const outcome = await deps.store.process(event.id, event.type, async (tx) => {
      result = await applyEvent(tx, event, now, env)
    })
    if (outcome === 'duplicate') result = 'duplicate: already processed'
    metrics.inc('web_stripe_webhook_total', { result: 'ok' })
    log.info('stripe webhook', { eventId: event.id, type: event.type, result })
    return { status: 200, body: { received: true, result } }
  } catch (err) {
    metrics.inc('web_stripe_webhook_total', { result: 'failed' })
    reportError('stripe webhook failed', err, { tags: { stripe_event_type: event.type }, extra: { eventId: event.id } })
    return { status: 500, body: { error: 'processing_failed', message: 'Event could not be applied. Stripe will retry.' } }
  }
}
