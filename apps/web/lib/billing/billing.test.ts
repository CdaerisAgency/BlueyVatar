import { readFileSync } from 'node:fs'
import pg from 'pg'
import Stripe from 'stripe'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { effectiveTier } from '@blueyvatar/core'
import { NOT_CONFIGURED, billingEnabled, missingForCheckout, missingForWebhook, plusEnabled, tierForPrice } from './config'
import { memoryBillingStore, postgresBillingStore } from './store'
import { checkoutParams, createCheckoutUrl, createPortalUrl } from './stripe'
import { handleStripeWebhook } from './webhook'
import { pgNoticeDirectory } from '@blueyvatar/core/verification'
import { resolvePlan } from '../plan'
import { formatPrice, PRICING } from '../pricing'

vi.spyOn(console, 'info').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

const SECRET = 'whsec_test_secret'
const env = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_BUSINESS: 'price_biz', STRIPE_PRICE_PLUS: 'price_plus' }
const DID = 'did:plc:alice'
const DAY = 86_400_000
const T0 = Date.parse('2026-11-01T00:00:00Z')
const sec = (ms: number) => Math.floor(ms / 1000)

let n = 0
function ev(type: string, object: object, at = T0): { payload: string; id: string } {
  const id = `evt_${++n}`
  return { id, payload: JSON.stringify({ id, object: 'event', type, created: sec(at), data: { object }, api_version: '2026-10-28.endive' }) }
}
const sign = (payload: string, secret = SECRET, ts = sec(Date.now())) => Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: ts })

const subObj = (o: Record<string, unknown> = {}) => ({
  id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false,
  metadata: { did: DID }, items: { data: [{ price: { id: 'price_pro' }, current_period_end: sec(T0 + 30 * DAY) }] }, ...o,
})

function setup(now = T0) {
  const store = memoryBillingStore()
  const send = (e: { payload: string }, header: string | null = sign(e.payload), at = now) =>
    handleStripeWebhook(e.payload, header, { store, env, now: () => new Date(at) })
  return { store, send }
}

describe('config', () => {
  it('reports what is missing and no-ops cleanly', async () => {
    expect(missingForCheckout({})).toEqual(['STRIPE_SECRET_KEY', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_BUSINESS'])
    expect(missingForWebhook({})).toEqual(['STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_PRO or STRIPE_PRICE_BUSINESS'])
    expect(billingEnabled({})).toBe(false)
    expect(billingEnabled(env)).toBe(true)
    expect(tierForPrice('price_biz', env)).toBe('business')
    expect(tierForPrice('price_other', env)).toBeNull()
    expect(tierForPrice('', {})).toBeNull()
  })
  it('webhook answers 503 with a clear message when Stripe env is unset', async () => {
    const r = await handleStripeWebhook('{}', 't=1,v1=x', { store: memoryBillingStore(), env: {} })
    expect(r.status).toBe(503)
    expect(r.body.error).toBe('stripe_not_configured')
    expect(r.body.message).toContain('STRIPE_WEBHOOK_SECRET')
  })
  it('checkout and portal return the not-configured message without calling Stripe', async () => {
    const ctx = { store: memoryBillingStore(), client: null, env: {}, baseUrl: 'https://blueyvatar.com' }
    expect(await createCheckoutUrl(ctx, DID, 'lic_1', 'pro')).toEqual({ ok: false, error: NOT_CONFIGURED })
    expect(await createPortalUrl(ctx, DID)).toEqual({ ok: false, error: NOT_CONFIGURED })
  })
})

describe('signature verification', () => {
  it('rejects a missing header, a wrong secret, a tampered body, and a stale timestamp', async () => {
    const { send, store } = setup()
    const e = ev('customer.subscription.created', subObj())
    expect((await send(e, null)).status).toBe(400)
    expect((await send(e, sign(e.payload, 'whsec_other'))).body.error).toBe('invalid_signature')
    expect((await send({ payload: e.payload.replace('sub_1', 'sub_2') }, sign(e.payload))).status).toBe(400)
    expect((await send(e, sign(e.payload, SECRET, sec(Date.now() - 3600_000)))).status).toBe(400)
    expect(store.eventCount()).toBe(0)
    expect(store.licenseOf(DID)).toBeUndefined()
  })
  it('accepts a correctly signed event', async () => {
    const { send } = setup()
    const e = ev('customer.subscription.created', subObj())
    expect((await send(e)).status).toBe(200)
  })
  it('acknowledges unhandled event types without recording them', async () => {
    const { send, store } = setup()
    const r = await send(ev('customer.created', { id: 'cus_1' }))
    expect(r.status).toBe(200)
    expect(r.body.result).toContain('ignored')
    expect(store.eventCount()).toBe(0)
  })
})

describe('event mapping', () => {
  it('checkout.session.completed links the customer to the DID and issues a license', async () => {
    const { send, store } = setup()
    const r = await send(ev('checkout.session.completed', { mode: 'subscription', customer: 'cus_1', client_reference_id: DID, metadata: { did: DID } }))
    expect(r.body.result).toBe('customer linked')
    expect(await store.customerFor(DID)).toBe('cus_1')
    expect(store.licenseOf(DID)?.tier).toBe('free')
  })
  it('ignores a checkout that is not a subscription or has no DID', async () => {
    const { send, store } = setup()
    expect((await send(ev('checkout.session.completed', { mode: 'payment', customer: 'cus_1', client_reference_id: DID }))).body.result).toContain('ignored')
    expect((await send(ev('checkout.session.completed', { mode: 'subscription', customer: 'cus_1' }))).body.result).toContain('ignored')
    expect(await store.customerFor(DID)).toBeNull()
  })
  it('subscription.created maps the Pro price to the pro tier and copies entitlements', async () => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', subObj()))
    const l = store.licenseOf(DID)!
    expect(l.tier).toBe('pro')
    expect(l.status).toBe('active')
    expect((l.entitlements as { maxKeys: number }).maxKeys).toBe(5)
  })
  it('maps the Business price, and a trialing subscription, to business', async () => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', subObj({ status: 'trialing', items: { data: [{ price: { id: 'price_biz' }, current_period_end: sec(T0) }] } })))
    expect(store.licenseOf(DID)?.tier).toBe('business')
  })
  it('subscription.updated moves between tiers', async () => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', subObj(), T0))
    await send(ev('customer.subscription.updated', subObj({ items: { data: [{ price: { id: 'price_biz' } }] } }), T0 + 1000))
    expect(store.licenseOf(DID)?.tier).toBe('business')
  })
  it('subscription.deleted drops to Free and keeps the license active', async () => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', subObj(), T0))
    await send(ev('customer.subscription.deleted', subObj({ status: 'canceled' }), T0 + 1000))
    expect(store.licenseOf(DID)).toMatchObject({ tier: 'free', status: 'active', graceEndsAt: null })
    expect(await store.subscriptionFor(DID)).toBeNull()
  })
  it.each(['unpaid', 'canceled', 'incomplete_expired', 'paused'])('status %s gives Free', async (status) => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', subObj(), T0))
    await send(ev('customer.subscription.updated', subObj({ status }), T0 + 1000))
    expect(store.licenseOf(DID)?.tier).toBe('free')
  })
  it('a subscription on an unknown price changes nothing', async () => {
    const { send, store } = setup()
    const r = await send(ev('customer.subscription.created', subObj({ items: { data: [{ price: { id: 'price_other' } }] } })))
    expect(r.body.result).toContain('ignored')
    expect(store.licenseOf(DID)).toBeUndefined()
  })
  it('resolves the DID through the linked customer when the subscription has no metadata', async () => {
    const { send, store } = setup()
    await send(ev('checkout.session.completed', { mode: 'subscription', customer: 'cus_1', client_reference_id: DID }))
    await send(ev('customer.subscription.created', subObj({ metadata: {} }), T0 + 1000))
    expect(store.licenseOf(DID)?.tier).toBe('pro')
  })
  it('answers 500 so Stripe retries when the customer is not linked yet, and succeeds on redelivery', async () => {
    const { send, store } = setup()
    const e = ev('customer.subscription.created', subObj({ metadata: {} }))
    expect((await send(e)).status).toBe(500)
    expect(store.eventCount()).toBe(0)
    await send(ev('checkout.session.completed', { mode: 'subscription', customer: 'cus_1', client_reference_id: DID }))
    expect((await send(e)).status).toBe(200)
    expect(store.licenseOf(DID)?.tier).toBe('pro')
  })
  it('ignores an event older than the stored state', async () => {
    const { send, store } = setup()
    await send(ev('customer.subscription.updated', subObj({ status: 'canceled' }), T0 + 5000))
    const r = await send(ev('customer.subscription.updated', subObj({ status: 'active' }), T0))
    expect(r.body.result).toContain('older')
    expect(store.licenseOf(DID)?.tier).toBe('free')
  })
  it('never changes an Enterprise license', async () => {
    const { send, store } = setup()
    store.seedLicense(DID, 'enterprise')
    await send(ev('customer.subscription.created', subObj()))
    expect(store.licenseOf(DID)?.tier).toBe('enterprise')
  })
  it('a second subscription keeps the higher tier when the lower one is canceled', async () => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', subObj({ id: 'sub_a' }), T0))
    await send(ev('customer.subscription.created', subObj({ id: 'sub_b', items: { data: [{ price: { id: 'price_biz' } }] } }), T0 + 1))
    await send(ev('customer.subscription.deleted', subObj({ id: 'sub_a', status: 'canceled' }), T0 + 2))
    expect(store.licenseOf(DID)?.tier).toBe('business')
  })
})

describe('invoice.payment_failed and grace', () => {
  const fail = (subscription: string | null, at: number, shape: 'legacy' | 'parent' = 'legacy') =>
    ev('invoice.payment_failed', shape === 'legacy' ? { subscription } : { parent: { subscription_details: { subscription } } }, at)

  it('marks the subscription past due, keeps the tier, and sets the 7 day grace end', async () => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', subObj(), T0))
    await send(fail('sub_1', T0 + DAY))
    const l = store.licenseOf(DID)!
    expect(l).toMatchObject({ tier: 'pro', status: 'past_due' })
    expect(l.graceEndsAt?.getTime()).toBe(T0 + DAY + 7 * DAY)
  })
  it('reads the subscription from the newer invoice parent shape', async () => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', subObj(), T0))
    await send(fail('sub_1', T0 + DAY, 'parent'))
    expect(store.licenseOf(DID)?.status).toBe('past_due')
  })
  it('a following subscription.updated past_due keeps the original grace start', async () => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', subObj(), T0))
    await send(fail('sub_1', T0 + DAY))
    await send(ev('customer.subscription.updated', subObj({ status: 'past_due' }), T0 + 2 * DAY))
    expect(store.licenseOf(DID)?.graceEndsAt?.getTime()).toBe(T0 + 8 * DAY)
  })
  it('recovery to active clears the grace period', async () => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', subObj(), T0))
    await send(fail('sub_1', T0 + DAY))
    await send(ev('customer.subscription.updated', subObj({ status: 'active' }), T0 + 2 * DAY))
    expect(store.licenseOf(DID)).toMatchObject({ tier: 'pro', status: 'active', graceEndsAt: null })
  })
  it('a late event after the grace period expires reads as Free', async () => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', subObj(), T0))
    await send(fail('sub_1', T0 + DAY))
    const l = store.licenseOf(DID)!
    // Read time: tier is served as Free with no webhook, exactly as delivery and the dashboard do.
    expect(effectiveTier(l as never, new Date(T0 + 7 * DAY))).toBe('pro')
    expect(effectiveTier(l as never, new Date(T0 + 8 * DAY))).toBe('free')
    // A later webhook that recomputes after expiry stores Free.
    await send(ev('customer.subscription.updated', subObj({ status: 'past_due' }), T0 + 9 * DAY), undefined, T0 + 9 * DAY)
    expect(store.licenseOf(DID)).toMatchObject({ tier: 'free', status: 'active', graceEndsAt: null })
  })
  it('ignores a failed first payment and an unknown subscription', async () => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', subObj({ status: 'incomplete' }), T0))
    expect((await send(fail('sub_1', T0 + 1000))).body.result).toContain('ignored')
    expect((await send(fail('sub_none', T0 + 1000))).body.result).toContain('ignored')
    expect(store.licenseOf(DID)?.tier).toBe('free')
  })
})

describe('idempotency', () => {
  it('applies a redelivered event once', async () => {
    const { send, store } = setup()
    const e = ev('customer.subscription.created', subObj())
    const first = await send(e)
    const spy = vi.spyOn(store, 'process')
    const second = await send(e)
    expect(first.body.result).toContain('subscription active')
    expect(second.status).toBe(200)
    expect(second.body.result).toContain('duplicate')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(store.eventCount()).toBe(1)
  })
  it('does not let a redelivered older event undo newer state', async () => {
    const { send, store } = setup()
    const created = ev('customer.subscription.created', subObj(), T0)
    await send(created)
    await send(ev('customer.subscription.deleted', subObj({ status: 'canceled' }), T0 + DAY))
    await send(created)
    expect(store.licenseOf(DID)?.tier).toBe('free')
  })
})

describe('billing notices', () => {
  const fail = (at: number) => ev('invoice.payment_failed', { subscription: 'sub_1' }, at)
  function withMail() {
    const store = memoryBillingStore()
    const mail: Array<{ did: string; kind: string; subject: string; text: string }> = []
    const notifier = { send: async (did: string, kind: string, n: { subject: string; text: string }) => { mail.push({ did, kind, ...n }); return 'sent' as const } }
    const send = (e: { payload: string }) => handleStripeWebhook(e.payload, sign(e.payload), { store, env, now: () => new Date(T0), notifier: notifier as never, publicUrl: 'https://blueyvatar.com' })
    return { mail, send }
  }

  it('mails a failed payment once with the grace end, DID, and settings link', async () => {
    const { mail, send } = withMail()
    await send(ev('customer.subscription.created', subObj(), T0))
    const f = fail(T0 + DAY)
    await send(f)
    await send(f) // Stripe redelivery
    await send(fail(T0 + 2 * DAY)) // a later retry of the same invoice
    expect(mail).toHaveLength(1)
    expect(mail[0]).toMatchObject({ did: DID, kind: 'billing', subject: 'Your blueyvatar payment failed' })
    expect(mail[0]!.text).toContain('2026-11-09')
    expect(mail[0]!.text).toContain(DID)
    expect(mail[0]!.text).toContain('https://blueyvatar.com/account/notifications')
  })
  it('mails grace expiry when a past-due subscription ends and the license drops to Free', async () => {
    const { mail, send } = withMail()
    await send(ev('customer.subscription.created', subObj(), T0))
    await send(fail(T0 + DAY))
    mail.length = 0
    const end = ev('customer.subscription.deleted', subObj({ status: 'canceled' }), T0 + 9 * DAY)
    await send(end)
    await send(end)
    expect(mail).toHaveLength(1)
    expect(mail[0]!.subject).toBe('Your blueyvatar Pro plan has ended')
  })
  it('mails cancellation once for an active subscription, and nothing for ordinary updates', async () => {
    const { mail, send } = withMail()
    await send(ev('customer.subscription.created', subObj(), T0))
    await send(ev('customer.subscription.updated', subObj({ cancel_at_period_end: true }), T0 + DAY))
    expect(mail).toEqual([])
    await send(ev('customer.subscription.deleted', subObj({ status: 'canceled' }), T0 + 2 * DAY))
    expect(mail.map((m) => m.subject)).toEqual(['Your blueyvatar Pro subscription was canceled'])
  })
  it('never fails the webhook when sending fails', async () => {
    const store = memoryBillingStore()
    const notifier = { send: async () => 'failed' as const }
    const e = ev('customer.subscription.created', subObj(), T0)
    await handleStripeWebhook(e.payload, sign(e.payload), { store, env, notifier })
    const f = fail(T0 + DAY)
    expect((await handleStripeWebhook(f.payload, sign(f.payload), { store, env, notifier })).status).toBe(200)
  })
})

describe('checkout and portal', () => {
  it('builds subscription Checkout params with automatic tax and DID metadata', () => {
    const p = checkoutParams({ did: DID, licenseId: 'lic_1', price: 'price_pro', customer: null, baseUrl: 'https://blueyvatar.com' })
    expect(p).toMatchObject({
      mode: 'subscription', line_items: [{ price: 'price_pro', quantity: 1 }], automatic_tax: { enabled: true },
      client_reference_id: DID, subscription_data: { metadata: { did: DID, license_id: 'lic_1' } },
      success_url: 'https://blueyvatar.com/account/billing?checkout=success',
    })
    expect(p.customer).toBeUndefined()
    expect(checkoutParams({ did: DID, licenseId: 'l', price: 'p', customer: 'cus_9', baseUrl: 'https://x.test' })).toMatchObject({ customer: 'cus_9', customer_update: { address: 'auto', name: 'auto' } })
  })
  it('creates a session for a new subscriber, reusing a known customer, and refuses a second subscription', async () => {
    const store = memoryBillingStore()
    const create = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.test/s' })
    const portal = vi.fn().mockResolvedValue({ url: 'https://billing.stripe.test/p' })
    const client = { checkout: { sessions: { create } }, billingPortal: { sessions: { create: portal } } } as never
    const ctx = { store, client, env, baseUrl: 'https://blueyvatar.com' }
    expect(await createPortalUrl(ctx, DID)).toMatchObject({ ok: false })
    expect(await createCheckoutUrl(ctx, DID, 'lic_1', 'business')).toEqual({ ok: true, url: 'https://checkout.stripe.test/s' })
    expect(create.mock.calls[0]![0]).toMatchObject({ line_items: [{ price: 'price_biz', quantity: 1 }], automatic_tax: { enabled: true } })
    let licenseId = ''
    await store.process('e1', 'x', async (tx) => {
      const l = await tx.ensureLicense(DID)
      licenseId = l.licenseId
      await tx.linkCustomer(DID, l.licenseId, 'cus_1')
      await tx.putSubscription({ id: 'sub_1', customerId: 'cus_1', did: DID, licenseId: l.licenseId, priceId: 'price_pro', tier: 'pro', status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false, pastDueSince: null, lastEventAt: new Date(T0) })
    })
    expect(await createPortalUrl(ctx, DID)).toEqual({ ok: true, url: 'https://billing.stripe.test/p' })
    expect(portal.mock.calls[0]![0]).toEqual({ customer: 'cus_1', return_url: 'https://blueyvatar.com/account/billing' })
    expect((await createCheckoutUrl(ctx, DID, licenseId, 'pro')).ok).toBe(false)
    expect(create).toHaveBeenCalledTimes(1)
    // Developer subscriptions are per license, so another license (an organization's) may subscribe.
    expect((await createCheckoutUrl(ctx, DID, 'lic_org', 'business')).ok).toBe(true)
    expect(create).toHaveBeenCalledTimes(2)
  })
})

describe('Plus', () => {
  const plusItems = { data: [{ price: { id: 'price_plus' }, current_period_end: sec(T0 + 30 * DAY) }] }
  const plusSub = (o: Record<string, unknown> = {}) => subObj({ id: 'sub_plus', items: plusItems, ...o })

  it('is priced at $9.99 per month', () => {
    const p = PRICING.find((t) => t.id === 'plus')!
    expect(p).toMatchObject({ amount: 9.99, per: 'mo' })
    expect(formatPrice(p.amount)).toBe('$9.99')
    expect(formatPrice(9)).toBe('$9')
    expect(formatPrice(0)).toBe('$0')
  })
  it('config: STRIPE_PRICE_PLUS is optional and maps to the plus plan', () => {
    const noPlus = { ...env, STRIPE_PRICE_PLUS: undefined }
    expect(tierForPrice('price_plus', env)).toBe('plus')
    expect(tierForPrice('price_plus', noPlus)).toBeNull()
    expect(missingForCheckout(noPlus)).toEqual([])
    expect(missingForCheckout(noPlus, 'plus')).toEqual(['STRIPE_PRICE_PLUS'])
    expect(billingEnabled(noPlus)).toBe(true)
    expect(plusEnabled(env)).toBe(true)
    expect(plusEnabled(noPlus)).toBe(false)
    expect(plusEnabled({})).toBe(false)
    expect(missingForWebhook({ STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PRICE_PLUS: 'price_plus' })).toEqual([])
  })
  it('an active Plus subscription grants Plus and leaves the developer license alone', async () => {
    const { send, store } = setup()
    expect((await send(ev('customer.subscription.created', plusSub()))).body.result).toBe('subscription active, tier plus')
    expect(await store.hasPlus(DID, new Date(T0))).toBe(true)
    expect(store.licenseOf(DID)).toMatchObject({ tier: 'free', status: 'active', graceEndsAt: null })
    expect(await resolvePlan(DID, store, new Date(T0))).toBe('plus')
    expect((await store.subscriptionFor(DID, 'plus'))?.id).toBe('sub_plus')
    expect(await store.subscriptionFor(DID)).toBeNull()
  })
  it('a trialing Plus subscription grants Plus', async () => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', plusSub({ status: 'trialing' })))
    expect(await store.hasPlus(DID, new Date(T0))).toBe(true)
  })
  it('Plus and Pro coexist: each changes only its own thing', async () => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', subObj(), T0))
    await send(ev('customer.subscription.created', plusSub(), T0 + 1000))
    expect(store.licenseOf(DID)?.tier).toBe('pro')
    expect(await store.hasPlus(DID, new Date(T0))).toBe(true)
    await send(ev('customer.subscription.deleted', plusSub({ status: 'canceled' }), T0 + 2000))
    expect(store.licenseOf(DID)?.tier).toBe('pro')
    expect(await store.hasPlus(DID, new Date(T0))).toBe(false)
    expect((await store.subscriptionFor(DID))?.tier).toBe('pro')
  })
  it.each(['unpaid', 'canceled', 'incomplete_expired', 'paused'])('status %s ends Plus', async (status) => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', plusSub(), T0))
    await send(ev('customer.subscription.updated', plusSub({ status }), T0 + 1000))
    expect(await store.hasPlus(DID, new Date(T0))).toBe(false)
  })
  it('a failed payment keeps Plus for the grace period, then it ends with no further event', async () => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', plusSub(), T0))
    const r = await send(ev('invoice.payment_failed', { subscription: 'sub_plus' }, T0 + DAY), undefined, T0 + DAY)
    expect(r.body.result).toBe('marked past due')
    expect(await store.hasPlus(DID, new Date(T0 + 7 * DAY))).toBe(true)
    expect(await store.hasPlus(DID, new Date(T0 + 8 * DAY))).toBe(false)
    expect(await resolvePlan(DID, store, new Date(T0 + 8 * DAY))).toBe('free')
    // Recovery clears the grace period.
    await send(ev('customer.subscription.updated', plusSub(), T0 + 2 * DAY), undefined, T0 + 2 * DAY)
    expect(await store.hasPlus(DID, new Date(T0 + 30 * DAY))).toBe(true)
  })
  it('ignores an older event, and redelivery changes nothing', async () => {
    const { send, store } = setup()
    await send(ev('customer.subscription.created', plusSub(), T0 + 5000))
    await send(ev('customer.subscription.updated', plusSub({ status: 'canceled' }), T0))
    expect(await store.hasPlus(DID, new Date(T0))).toBe(true)
    const again = ev('customer.subscription.updated', plusSub({ status: 'canceled' }), T0 + 9000)
    await send(again)
    expect((await send(again)).body.result).toContain('duplicate')
    expect(await store.hasPlus(DID, new Date(T0))).toBe(false)
  })
  it('a manual PLUS_DIDS grant still gives Plus with no subscription', async () => {
    const store = memoryBillingStore()
    const prev = process.env.PLUS_DIDS
    process.env.PLUS_DIDS = `did:plc:other, ${DID}`
    try {
      expect(await resolvePlan(DID, store)).toBe('plus')
      expect(await resolvePlan('did:plc:nobody', store)).toBe('free')
    } finally {
      if (prev === undefined) delete process.env.PLUS_DIDS
      else process.env.PLUS_DIDS = prev
    }
  })
  it('Checkout sells Plus with the Plus price, alongside an existing developer subscription, but not twice', async () => {
    const store = memoryBillingStore()
    const create = vi.fn(async (_params: unknown) => ({ url: 'https://checkout.stripe.test/plus' }))
    const ctx = { store, client: { checkout: { sessions: { create } }, billingPortal: { sessions: { create: vi.fn() } } } as never, env, baseUrl: 'https://blueyvatar.com' }
    await store.process('e1', 'x', async (tx) => {
      const l = await tx.ensureLicense(DID)
      await tx.putSubscription({ id: 'sub_1', customerId: 'cus_1', did: DID, licenseId: l.licenseId, priceId: 'price_pro', tier: 'pro', status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false, pastDueSince: null, lastEventAt: new Date(T0) })
    })
    expect(await createCheckoutUrl(ctx, DID, 'lic_1', 'plus')).toEqual({ ok: true, url: 'https://checkout.stripe.test/plus' })
    expect(create.mock.calls[0]![0]).toMatchObject({ line_items: [{ price: 'price_plus', quantity: 1 }], automatic_tax: { enabled: true }, subscription_data: { metadata: { did: DID } } })
    await store.process('e2', 'x', async (tx) => {
      const l = await tx.ensureLicense(DID)
      await tx.putSubscription({ id: 'sub_plus', customerId: 'cus_1', did: DID, licenseId: l.licenseId, priceId: 'price_plus', tier: 'plus', status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false, pastDueSince: null, lastEventAt: new Date(T0) })
    })
    expect((await createCheckoutUrl(ctx, DID, 'lic_1', 'plus')).ok).toBe(false)
    expect(create).toHaveBeenCalledTimes(1)
  })
  it('Checkout for Plus reports the missing price when STRIPE_PRICE_PLUS is unset', async () => {
    const ctx = { store: memoryBillingStore(), client: {} as never, env: { ...env, STRIPE_PRICE_PLUS: undefined }, baseUrl: 'https://blueyvatar.com' }
    expect(await createCheckoutUrl(ctx, DID, 'lic_1', 'plus')).toEqual({ ok: false, error: NOT_CONFIGURED })
  })
})

const url = process.env.TEST_DATABASE_URL
const schema = `t_billing_${process.pid}_${Date.now()}`
describe.skipIf(!url)('postgres billing store', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    for (const f of ['0001_init.sql', '0015_billing.sql', '0017_plus_subscriptions.sql', '0019_notification_prefs.sql', '0022_account_deletion.sql', '0024_organizations.sql']) await pool.query(readFileSync(new URL(`../../../../db/migrations/${f}`, import.meta.url), 'utf8'))
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })

  it('stores notification preferences, defaulting to on', async () => {
    const d = pgNoticeDirectory(pool)
    expect(await d.prefs(DID)).toEqual({ usageAlerts: true, billingNotices: true })
    await d.setPrefs(DID, { usageAlerts: false, billingNotices: true })
    await d.setPrefs(DID, { usageAlerts: false, billingNotices: false })
    expect(await d.prefs(DID)).toEqual({ usageAlerts: false, billingNotices: false })
    expect(await d.prefs('did:plc:other')).toEqual({ usageAlerts: true, billingNotices: true })
  })
  it('applies events end to end, writes the license row, and is idempotent under concurrent redelivery', async () => {
    const store = postgresBillingStore(pool)
    const send = (e: { payload: string }, at = T0) => handleStripeWebhook(e.payload, sign(e.payload), { store, env, now: () => new Date(at) })
    const created = ev('customer.subscription.created', subObj(), T0)
    const results = await Promise.all([send(created), send(created), send(created)])
    expect(results.map((r) => r.status)).toEqual([200, 200, 200])
    expect(results.filter((r) => r.body.result?.startsWith('duplicate')).length).toBe(2)
    const lic = await pool.query('SELECT tier, status, grace_ends_at, attribution_required, term FROM licenses WHERE owner = $1', [DID])
    expect(lic.rows).toHaveLength(1)
    expect(lic.rows[0]).toMatchObject({ tier: 'pro', status: 'active', grace_ends_at: null, attribution_required: false, term: 'monthly' })
    expect((await pool.query('SELECT count(*)::int AS c FROM stripe_events')).rows[0].c).toBe(1)

    await send(ev('invoice.payment_failed', { subscription: 'sub_1' }, T0 + DAY), T0 + DAY)
    const past = (await pool.query('SELECT tier, status, grace_ends_at FROM licenses WHERE owner = $1', [DID])).rows[0]
    expect(past).toMatchObject({ tier: 'pro', status: 'past_due' })
    expect(new Date(past.grace_ends_at).getTime()).toBe(T0 + 8 * DAY)
    expect((await store.subscriptionFor(DID))?.status).toBe('past_due')

    await send(ev('customer.subscription.deleted', subObj({ status: 'canceled' }), T0 + 2 * DAY), T0 + 2 * DAY)
    expect((await pool.query('SELECT tier, status, grace_ends_at FROM licenses WHERE owner = $1', [DID])).rows[0]).toMatchObject({ tier: 'free', status: 'active', grace_ends_at: null })
  })

  it('rolls back and leaves the event unrecorded when processing fails, so a retry runs', async () => {
    const store = postgresBillingStore(pool)
    await expect(store.process('evt_fail', 'x', async (tx) => { await tx.ensureLicense('did:plc:bob'); throw new Error('boom') })).rejects.toThrow('boom')
    expect((await pool.query("SELECT 1 FROM stripe_events WHERE event_id = 'evt_fail'")).rowCount).toBe(0)
    expect((await pool.query("SELECT 1 FROM licenses WHERE owner = 'did:plc:bob'")).rowCount).toBe(0)
    expect(await store.process('evt_fail', 'x', async () => {})).toBe('processed')
    expect(await store.process('evt_fail', 'x', async () => {})).toBe('duplicate')
  })

  it('stores a Plus subscription, grants Plus, and leaves the license tier alone', async () => {
    const store = postgresBillingStore(pool)
    const did = 'did:plc:plusbuyer'
    const send = (e: { payload: string }, at = T0) => handleStripeWebhook(e.payload, sign(e.payload), { store, env, now: () => new Date(at) })
    const o = { id: 'sub_pg_plus', customer: 'cus_pg_plus', status: 'active', metadata: { did }, items: { data: [{ price: { id: 'price_plus' }, current_period_end: sec(T0 + 30 * DAY) }] } }
    expect((await send(ev('customer.subscription.created', o, T0))).body.result).toBe('subscription active, tier plus')
    expect((await pool.query("SELECT tier FROM subscriptions WHERE stripe_subscription_id = 'sub_pg_plus'")).rows[0].tier).toBe('plus')
    expect((await pool.query('SELECT tier FROM licenses WHERE owner = $1', [did])).rows[0].tier).toBe('free')
    expect(await store.hasPlus(did, new Date(T0))).toBe(true)
    expect((await store.subscriptionFor(did, 'plus'))?.tier).toBe('plus')
    expect(await store.subscriptionFor(did)).toBeNull()
    await send(ev('invoice.payment_failed', { subscription: 'sub_pg_plus' }, T0 + DAY), T0 + DAY)
    expect(await store.hasPlus(did, new Date(T0 + 7 * DAY))).toBe(true)
    expect(await store.hasPlus(did, new Date(T0 + 9 * DAY))).toBe(false)
  })

  it('rejects a tier outside pro, business, and plus', async () => {
    await expect(pool.query(`INSERT INTO subscriptions (stripe_subscription_id, stripe_customer_id, did, license_id, price_id, tier, status, last_event_at)
      SELECT 'sub_bad', 'cus_bad', owner, license_id, 'p', 'gold', 'active', now() FROM licenses LIMIT 1`)).rejects.toThrow()
  })

  it('does not touch an Enterprise license', async () => {
    const store = postgresBillingStore(pool)
    await pool.query("INSERT INTO licenses (license_id, owner, tier) VALUES ('lic_ent', 'did:plc:corp', 'enterprise')")
    await store.process('evt_ent', 'x', async (tx) => {
      await tx.applyLicense('lic_ent', { tier: 'free', status: 'active', graceEndsAt: null })
    })
    expect((await pool.query("SELECT tier FROM licenses WHERE license_id = 'lic_ent'")).rows[0].tier).toBe('enterprise')
  })
})
