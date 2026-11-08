import Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { memoryBillingStore, type SubscriptionRow } from './store'
import { changePlan, setCancelAtPeriodEnd, subscriptionToSwitch } from './stripe'
import { longDate, summarize } from './summary'
import { handleStripeWebhook } from './webhook'

vi.spyOn(console, 'info').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

// All identifiers here are fake. No Stripe call is made: the client is a mock.
const SECRET = 'whsec_test_secret'
const env = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PRICE_BUSINESS: 'price_biz', STRIPE_PRICE_PLUS: 'price_plus,price_old_pro,price_old_plus' }
const DID = 'did:plc:alice'
const DAY = 86_400_000
const T0 = Date.parse('2026-11-01T00:00:00Z')
const sec = (ms: number) => Math.floor(ms / 1000)

async function seed(rows: Array<Partial<SubscriptionRow> & { id: string; tier: SubscriptionRow['tier'] }>) {
  const store = memoryBillingStore()
  let licenseId = ''
  await store.process('seed', 'x', async (tx) => {
    const l = await tx.ensureLicense(DID)
    licenseId = l.licenseId
    await tx.linkCustomer(DID, l.licenseId, 'cus_1')
    for (const r of rows) {
      await tx.putSubscription({ customerId: 'cus_1', did: DID, licenseId, priceId: `price_${r.tier}`, status: 'active', currentPeriodEnd: new Date(T0 + 20 * DAY), cancelAtPeriodEnd: false, pastDueSince: null, lastEventAt: new Date(T0), ...r })
    }
  })
  return { store, licenseId }
}

function mockClient(priceId = 'price_plus', customer = 'cus_1', items = 1) {
  const retrieve = vi.fn().mockResolvedValue({ customer, items: { data: Array.from({ length: items }, (_, i) => ({ id: `si_${i}`, price: { id: priceId } })) } })
  const update = vi.fn().mockResolvedValue({})
  return { retrieve, update, client: { checkout: {}, billingPortal: {}, subscriptions: { retrieve, update } } as never }
}

describe('subscriptionToSwitch', () => {
  const row = (tier: SubscriptionRow['tier']) => ({ tier }) as SubscriptionRow
  it('switches the held subscription to the other plan', () => {
    expect(subscriptionToSwitch(row('plus'), 'business')).toEqual({ sub: row('plus') })
    expect(subscriptionToSwitch(row('business'), 'plus')).toEqual({ sub: row('business') })
  })
  it('refuses the current plan and no plan', () => {
    expect(subscriptionToSwitch(row('plus'), 'plus')).toEqual({ error: 'You are already on Plus.' })
    expect('error' in subscriptionToSwitch(null, 'plus')).toBe(true)
  })
})

describe('changePlan', () => {
  it('reports not configured without calling Stripe', async () => {
    const { store, licenseId } = await seed([{ id: 'sub_1', tier: 'plus' }])
    expect(await changePlan({ store, client: null, env: {}, baseUrl: 'x' }, DID, licenseId, 'business')).toMatchObject({ ok: false, error: expect.stringContaining('not configured') })
  })
  it('upgrades by replacing the item, invoicing the difference now, and failing without updating if payment fails', async () => {
    const { store, licenseId } = await seed([{ id: 'sub_1', tier: 'plus' }])
    const m = mockClient('price_plus')
    expect((await changePlan({ store, client: m.client, env, baseUrl: 'x' }, DID, licenseId, 'business')).ok).toBe(true)
    expect(m.update).toHaveBeenCalledTimes(1)
    const [id, params, opts] = m.update.mock.calls[0]!
    expect(id).toBe('sub_1')
    expect(params).toEqual({ items: [{ id: 'si_0', price: 'price_biz', quantity: 1 }], proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete' })
    expect(opts.idempotencyKey).toContain('sub_1')
  })
  it('downgrades with a credit on the next invoice and no immediate charge', async () => {
    const { store, licenseId } = await seed([{ id: 'sub_1', tier: 'business' }])
    const m = mockClient('price_biz')
    await changePlan({ store, client: m.client, env, baseUrl: 'x' }, DID, licenseId, 'plus')
    expect(m.update.mock.calls[0]![1]).toMatchObject({ items: [{ price: 'price_plus' }], proration_behavior: 'create_prorations' })
  })
  it('decides upgrade or downgrade by price: only Plus ($9) and Business ($49) remain', async () => {
    const a = await seed([{ id: 'sub_1', tier: 'plus' }])
    const m1 = mockClient('price_plus')
    await changePlan({ store: a.store, client: m1.client, env, baseUrl: 'x' }, DID, a.licenseId, 'business')
    expect(m1.update.mock.calls[0]![1]).toMatchObject({ items: [{ price: 'price_biz' }], proration_behavior: 'always_invoice' })
    const b = await seed([{ id: 'sub_1', tier: 'business' }])
    const m2 = mockClient('price_biz')
    await changePlan({ store: b.store, client: m2.client, env, baseUrl: 'x' }, DID, b.licenseId, 'plus')
    expect(m2.update.mock.calls[0]![1]).toMatchObject({ items: [{ price: 'price_plus' }], proration_behavior: 'create_prorations' })
  })
  it('a subscriber on the retired Pro price can switch to Business and is told they are on Plus', async () => {
    const a = await seed([{ id: 'sub_1', tier: 'plus', priceId: 'price_old_pro' }])
    const m = mockClient('price_old_pro')
    expect((await changePlan({ store: a.store, client: m.client, env, baseUrl: 'x' }, DID, a.licenseId, 'business')).ok).toBe(true)
    expect(await changePlan({ store: a.store, client: m.client, env, baseUrl: 'x' }, DID, a.licenseId, 'plus')).toMatchObject({ ok: false, error: 'You are already on Plus.' })
  })
  it('a Stripe error leaves the plan unchanged and says so', async () => {
    const { store, licenseId } = await seed([{ id: 'sub_1', tier: 'plus' }])
    const m = mockClient('price_plus')
    m.update.mockRejectedValue(new Error('card_declined sk_live_secret'))
    const r = await changePlan({ store, client: m.client, env, baseUrl: 'x' }, DID, licenseId, 'business')
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('not changed') })
    expect(JSON.stringify(r)).not.toContain('sk_live')
  })
  it('refuses past due, ending, and non-active subscriptions, other accounts, and multi-item subscriptions', async () => {
    const run = async (row: Partial<SubscriptionRow>, mock = mockClient('price_plus')) => {
      const { store, licenseId } = await seed([{ id: 'sub_1', tier: 'plus', ...row }])
      const r = await changePlan({ store, client: mock.client, env, baseUrl: 'x' }, DID, licenseId, 'business')
      return { r, mock }
    }
    for (const row of [{ status: 'past_due' as const }, { cancelAtPeriodEnd: true }]) {
      const { r, mock } = await run(row)
      expect(r.ok).toBe(false)
      expect(mock.retrieve).not.toHaveBeenCalled()
    }
    expect((await run({}, mockClient('price_plus', 'cus_other'))).r.ok).toBe(false)
    expect((await run({}, mockClient('price_plus', 'cus_1', 2))).r.ok).toBe(false)
    expect((await run({}, mockClient('price_biz'))).mock.update).not.toHaveBeenCalled()
  })
})

describe('setCancelAtPeriodEnd', () => {
  it('cancels at period end and resumes before the end', async () => {
    const a = await seed([{ id: 'sub_1', tier: 'plus' }])
    const m = mockClient()
    expect((await setCancelAtPeriodEnd({ store: a.store, client: m.client, env, baseUrl: 'x' }, DID, a.licenseId, true, new Date(T0))).ok).toBe(true)
    expect(m.update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true })
    const b = await seed([{ id: 'sub_1', tier: 'plus', cancelAtPeriodEnd: true }])
    const m2 = mockClient()
    expect((await setCancelAtPeriodEnd({ store: b.store, client: m2.client, env, baseUrl: 'x' }, DID, b.licenseId, false, new Date(T0))).ok).toBe(true)
    expect(m2.update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: false })
  })
  it('does not resume after the period ended, or cancel twice, or act without a subscription', async () => {
    const a = await seed([{ id: 'sub_1', tier: 'plus', cancelAtPeriodEnd: true }])
    const m = mockClient()
    const ctx = { store: a.store, client: m.client, env, baseUrl: 'x' }
    expect((await setCancelAtPeriodEnd(ctx, DID, a.licenseId, false, new Date(T0 + 30 * DAY))).ok).toBe(false)
    expect((await setCancelAtPeriodEnd(ctx, DID, a.licenseId, true, new Date(T0))).ok).toBe(false)
    expect((await setCancelAtPeriodEnd(ctx, DID, a.licenseId, true, new Date(T0))).ok).toBe(false)
    expect(m.update).not.toHaveBeenCalled()
    expect((await setCancelAtPeriodEnd({ ...ctx, client: null, env: {} }, DID, a.licenseId, true)).ok).toBe(false)
  })
})

describe('summarize', () => {
  it('describes renewal, ending, and failed payment in plain English', () => {
    const end = new Date('2026-11-30T12:00:00Z')
    expect(longDate(end)).toBe('November 30, 2026')
    expect(summarize({ tier: 'plus', status: 'active', currentPeriodEnd: end, cancelAtPeriodEnd: false })).toEqual({ plan: 'Plus', price: '$9 per month', status: 'Active', when: 'Renews on November 30, 2026' })
    expect(summarize({ tier: 'plus', status: 'active', currentPeriodEnd: end, cancelAtPeriodEnd: true })).toMatchObject({ price: '$9 per month', when: 'Ends on November 30, 2026 (you keep Plus until then)' })
    expect(summarize({ tier: 'business', status: 'past_due', currentPeriodEnd: null, cancelAtPeriodEnd: false })).toMatchObject({ status: 'Payment failed', when: null, price: '$49 per month' })
  })
})

describe('webhook follows plan changes, cancellation, and failed payments', () => {
  let n = 0
  const sign = (payload: string) => Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET, timestamp: sec(Date.now()) })
  const sub = (o: Record<string, unknown> = {}) => ({ id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, metadata: { did: DID }, items: { data: [{ price: { id: 'price_plus' }, current_period_end: sec(T0 + 30 * DAY) }] }, ...o })
  const send = (store: ReturnType<typeof memoryBillingStore>, type: string, object: object, at: number, id = `evt_${++n}`) => {
    const payload = JSON.stringify({ id, object: 'event', type, created: sec(at), data: { object }, api_version: '2026-10-28.endive' })
    return handleStripeWebhook(payload, sign(payload), { store, env, now: () => new Date(at) })
  }
  const price = (p: string) => ({ items: { data: [{ price: { id: p }, current_period_end: sec(T0 + 30 * DAY) }] } })

  it('upgrade, downgrade, cancel at period end, resume, and the end all move the license', async () => {
    const store = memoryBillingStore()
    await send(store, 'customer.subscription.created', sub(), T0)
    expect(store.licenseOf(DID)?.tier).toBe('plus')
    await send(store, 'customer.subscription.updated', sub(price('price_biz')), T0 + DAY)
    expect(store.licenseOf(DID)?.tier).toBe('business')
    await send(store, 'customer.subscription.updated', sub(price('price_plus')), T0 + 2 * DAY)
    expect(store.licenseOf(DID)?.tier).toBe('plus')
    await send(store, 'customer.subscription.updated', sub({ cancel_at_period_end: true }), T0 + 3 * DAY)
    expect((await store.subscriptionFor(DID))?.cancelAtPeriodEnd).toBe(true)
    expect(store.licenseOf(DID)?.tier).toBe('plus')
    await send(store, 'customer.subscription.updated', sub({ cancel_at_period_end: false }), T0 + 4 * DAY)
    expect((await store.subscriptionFor(DID))?.cancelAtPeriodEnd).toBe(false)
    await send(store, 'customer.subscription.deleted', sub({ status: 'canceled', cancel_at_period_end: true }), T0 + 30 * DAY)
    expect(store.licenseOf(DID)?.tier).toBe('free')
  })

  it('Plus sets the license tier and the Plus plan; the retired Pro and old Plus prices map to Plus without error', async () => {
    const store = memoryBillingStore()
    const r = await send(store, 'customer.subscription.created', sub(price('price_old_pro')), T0)
    expect(r.status).toBe(200)
    expect(store.licenseOf(DID)?.tier).toBe('plus')
    expect(await store.hasPlus(DID, new Date(T0))).toBe(true)
    const r2 = await send(store, 'customer.subscription.updated', sub(price('price_old_plus')), T0 + DAY)
    expect(r2.status).toBe(200)
    expect(store.licenseOf(DID)?.tier).toBe('plus')
  })

  it('an unconfigured price still updates a subscription we already hold, so a cancellation is not dropped', async () => {
    const store = memoryBillingStore()
    await send(store, 'customer.subscription.created', sub(), T0)
    await send(store, 'customer.subscription.deleted', sub({ status: 'canceled', ...price('price_gone') }), T0 + DAY)
    expect(store.licenseOf(DID)?.tier).toBe('free')
    const unknown = await send(memoryBillingStore(), 'customer.subscription.created', sub(price('price_gone')), T0)
    expect(unknown.body.result).toContain('ignored')
  })

  it('Business includes Plus for the person', async () => {
    const store = memoryBillingStore()
    await send(store, 'customer.subscription.created', sub(price('price_biz')), T0)
    expect(await store.hasPlus(DID, new Date(T0))).toBe(true)
  })

  it('a failed payment starts the grace period, and payment recovery clears it', async () => {
    const store = memoryBillingStore()
    await send(store, 'customer.subscription.created', sub(), T0)
    await send(store, 'invoice.payment_failed', { subscription: 'sub_1' }, T0 + 30 * DAY)
    expect(store.licenseOf(DID)).toMatchObject({ tier: 'plus', status: 'past_due' })
    await send(store, 'customer.subscription.updated', sub({ status: 'active' }), T0 + 32 * DAY)
    expect(store.licenseOf(DID)).toMatchObject({ tier: 'plus', status: 'active', graceEndsAt: null })
  })

  it('redelivery of a plan change applies once', async () => {
    const store = memoryBillingStore()
    await send(store, 'customer.subscription.created', sub(), T0)
    const r1 = await send(store, 'customer.subscription.updated', sub(price('price_biz')), T0 + DAY, 'evt_same')
    const r2 = await send(store, 'customer.subscription.updated', sub(price('price_biz')), T0 + DAY, 'evt_same')
    expect(r1.body.result).toContain('business')
    expect(r2.body.result).toContain('duplicate')
    // An older delivery after a newer one cannot undo it.
    await send(store, 'customer.subscription.updated', sub(price('price_plus')), T0 + DAY / 2)
    expect(store.licenseOf(DID)?.tier).toBe('business')
  })
})
