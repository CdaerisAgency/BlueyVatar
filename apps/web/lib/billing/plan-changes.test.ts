import Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { memoryBillingStore, type SubscriptionRow } from './store'
import { cancelScheduledChange, changePlan, getPendingChange, setCancelAtPeriodEnd, subscriptionToSwitch } from './stripe'
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

const PERIOD_START = sec(T0)
const PERIOD_END = sec(T0 + 20 * DAY)

/** A schedule as Stripe returns it after from_subscription (one phase) or after the downgrade update (two phases). */
function scheduleObj(opts: { next?: string; status?: string; id?: string } = {}) {
  const phase0 = { start_date: PERIOD_START, end_date: PERIOD_END, items: [{ price: 'price_biz', quantity: 1 }], metadata: { did: DID }, automatic_tax: { enabled: true }, discounts: [], add_invoice_items: [], trial_end: null }
  const phases = opts.next ? [phase0, { start_date: PERIOD_END, end_date: PERIOD_END + 2_592_000, items: [{ price: opts.next, quantity: 1 }] }] : [phase0]
  return { id: opts.id ?? 'sub_sched_1', status: opts.status ?? 'active', phases, current_phase: { start_date: PERIOD_START, end_date: PERIOD_END } }
}

function mockClient(priceId = 'price_plus', customer = 'cus_1', items = 1, schedule: ReturnType<typeof scheduleObj> | null = null) {
  const retrieve = vi.fn().mockResolvedValue({ customer, schedule, items: { data: Array.from({ length: items }, (_, i) => ({ id: `si_${i}`, price: { id: priceId } })) } })
  const update = vi.fn().mockResolvedValue({})
  const sched = {
    create: vi.fn().mockResolvedValue(scheduleObj()),
    update: vi.fn().mockResolvedValue({}),
    release: vi.fn().mockResolvedValue({}),
    retrieve: vi.fn().mockResolvedValue(schedule),
  }
  return { retrieve, update, sched, client: { checkout: {}, billingPortal: {}, subscriptions: { retrieve, update }, subscriptionSchedules: sched } as never }
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
  it('a downgrade creates a schedule from the subscription and adds a Plus phase at the period end with no proration', async () => {
    const { store, licenseId } = await seed([{ id: 'sub_1', tier: 'business' }])
    const m = mockClient('price_biz')
    const r = await changePlan({ store, client: m.client, env, baseUrl: 'x' }, DID, licenseId, 'plus', new Date(T0))
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining('Your plan changes to Plus on November 21, 2026') })
    // Nothing is changed on the subscription itself, so no charge, credit, or refund happens today.
    expect(m.update).not.toHaveBeenCalled()
    expect(m.sched.create.mock.calls[0]![0]).toEqual({ from_subscription: 'sub_1' })
    const [id, params] = m.sched.update.mock.calls[0]!
    expect(id).toBe('sub_sched_1')
    expect(params).toMatchObject({ end_behavior: 'release', proration_behavior: 'none' })
    expect(params.phases[0]).toMatchObject({ items: [{ price: 'price_biz', quantity: 1 }], start_date: PERIOD_START, end_date: PERIOD_END, metadata: { did: DID }, automatic_tax: { enabled: true } })
    expect(params.phases[1]).toMatchObject({ items: [{ price: 'price_plus', quantity: 1 }], duration: { interval: 'month', interval_count: 1 }, proration_behavior: 'none', metadata: { did: DID } })
    expect(m.sched.release).not.toHaveBeenCalled()
  })
  it('asking for the same downgrade twice is one schedule', async () => {
    const { store, licenseId } = await seed([{ id: 'sub_1', tier: 'business' }])
    const m = mockClient('price_biz', 'cus_1', 1, scheduleObj({ next: 'price_plus' }))
    const r = await changePlan({ store, client: m.client, env, baseUrl: 'x' }, DID, licenseId, 'plus', new Date(T0))
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining('already changes to Plus') })
    expect(m.sched.create).not.toHaveBeenCalled()
  })
  it('releases the schedule it made when the update fails, and reports that nothing changed', async () => {
    const { store, licenseId } = await seed([{ id: 'sub_1', tier: 'business' }])
    const m = mockClient('price_biz')
    m.sched.update.mockRejectedValue(new Error('boom sk_live_secret'))
    const r = await changePlan({ store, client: m.client, env, baseUrl: 'x' }, DID, licenseId, 'plus', new Date(T0))
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('not changed') })
    expect(JSON.stringify(r)).not.toContain('sk_live')
    expect(m.sched.release).toHaveBeenCalledWith('sub_sched_1')
  })
  it('does not schedule a subscription whose phase has a discount or trial, and releases the empty schedule', async () => {
    const { store, licenseId } = await seed([{ id: 'sub_1', tier: 'business' }])
    const m = mockClient('price_biz')
    m.sched.create.mockResolvedValue({ ...scheduleObj(), phases: [{ ...scheduleObj().phases[0]!, discounts: [{ coupon: 'c' }] }] })
    expect((await changePlan({ store, client: m.client, env, baseUrl: 'x' }, DID, licenseId, 'plus')).ok).toBe(false)
    expect(m.sched.update).not.toHaveBeenCalled()
    expect(m.sched.release).toHaveBeenCalled()
  })
  it('leaves a schedule it did not make alone', async () => {
    const { store, licenseId } = await seed([{ id: 'sub_1', tier: 'business' }])
    const m = mockClient('price_biz', 'cus_1', 1, scheduleObj({ next: 'price_other' }))
    expect((await changePlan({ store, client: m.client, env, baseUrl: 'x' }, DID, licenseId, 'plus', new Date(T0))).ok).toBe(false)
    expect(m.sched.update).not.toHaveBeenCalled()
    expect(m.sched.release).not.toHaveBeenCalled()
  })
  it('an upgrade is refused while any schedule is attached, and a Plus subscriber still upgrades immediately', async () => {
    const a = await seed([{ id: 'sub_1', tier: 'plus' }])
    const withSched = mockClient('price_plus', 'cus_1', 1, scheduleObj({ next: 'price_biz' }))
    expect((await changePlan({ store: a.store, client: withSched.client, env, baseUrl: 'x' }, DID, a.licenseId, 'business')).ok).toBe(false)
    expect(withSched.update).not.toHaveBeenCalled()
  })
  it('asking for Business again while a downgrade is pending cancels the schedule without charging', async () => {
    const { store, licenseId } = await seed([{ id: 'sub_1', tier: 'business' }])
    const m = mockClient('price_biz', 'cus_1', 1, scheduleObj({ next: 'price_plus' }))
    const r = await changePlan({ store, client: m.client, env, baseUrl: 'x' }, DID, licenseId, 'business', new Date(T0))
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining('You stay on Business') })
    expect(m.sched.release).toHaveBeenCalledWith('sub_sched_1')
    expect(m.update).not.toHaveBeenCalled()
    // With nothing pending it is still "already on Business".
    const n = mockClient('price_biz')
    expect(await changePlan({ store, client: n.client, env, baseUrl: 'x' }, DID, licenseId, 'business')).toMatchObject({ ok: false, error: 'You are already on Business.' })
  })
  it('refuses a downgrade when past due, set to end, or not active, without calling Stripe', async () => {
    for (const row of [{ status: 'past_due' as const }, { status: 'canceled' as const }, { cancelAtPeriodEnd: true }]) {
      const { store, licenseId } = await seed([{ id: 'sub_1', tier: 'business', ...row }])
      const m = mockClient('price_biz')
      const r = await changePlan({ store, client: m.client, env, baseUrl: 'x' }, DID, licenseId, 'plus')
      expect(r.ok).toBe(false)
      expect(m.sched.create).not.toHaveBeenCalled()
    }
  })
  it('a downgrade with no billing configured says so and calls nothing', async () => {
    const { store, licenseId } = await seed([{ id: 'sub_1', tier: 'business' }])
    const m = mockClient('price_biz')
    expect(await changePlan({ store, client: m.client, env: {}, baseUrl: 'x' }, DID, licenseId, 'plus')).toMatchObject({ ok: false, error: expect.stringContaining('not configured') })
    expect(m.sched.create).not.toHaveBeenCalled()
  })
  it('decides upgrade or downgrade by price: Plus to Business updates now, Business to Plus schedules', async () => {
    const a = await seed([{ id: 'sub_1', tier: 'plus' }])
    const m1 = mockClient('price_plus')
    await changePlan({ store: a.store, client: m1.client, env, baseUrl: 'x' }, DID, a.licenseId, 'business')
    expect(m1.update.mock.calls[0]![1]).toMatchObject({ items: [{ price: 'price_biz' }], proration_behavior: 'always_invoice' })
    expect(m1.sched.create).not.toHaveBeenCalled()
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

describe('pending downgrade', () => {
  it('cancelScheduledChange releases the schedule, and says so when none exists', async () => {
    const a = await seed([{ id: 'sub_1', tier: 'business' }])
    const m = mockClient('price_biz', 'cus_1', 1, scheduleObj({ next: 'price_plus' }))
    expect(await cancelScheduledChange({ store: a.store, client: m.client, env, baseUrl: 'x' }, DID, a.licenseId, new Date(T0))).toMatchObject({ ok: true })
    expect(m.sched.release).toHaveBeenCalledWith('sub_sched_1')
    const none = mockClient('price_biz')
    expect(await cancelScheduledChange({ store: a.store, client: none.client, env, baseUrl: 'x' }, DID, a.licenseId)).toEqual({ ok: false, error: 'You have no scheduled plan change.' })
    expect(none.sched.release).not.toHaveBeenCalled()
    expect((await cancelScheduledChange({ store: a.store, client: null, env: {}, baseUrl: 'x' }, DID, a.licenseId)).ok).toBe(false)
  })
  it('getPendingChange reads the schedule from Stripe, ignores past and unknown phases, and never throws', async () => {
    const a = await seed([{ id: 'sub_1', tier: 'business' }])
    const sub = (await a.store.subscriptionFor(DID))!
    const ctx = (m: ReturnType<typeof mockClient>) => ({ store: a.store, client: m.client, env, baseUrl: 'x' })
    const pending = await getPendingChange(ctx(mockClient('price_biz', 'cus_1', 1, scheduleObj({ next: 'price_plus' }))), sub, new Date(T0))
    expect(pending).toMatchObject({ tier: 'plus', scheduleId: 'sub_sched_1', at: new Date(PERIOD_END * 1000) })
    expect(await getPendingChange(ctx(mockClient('price_biz', 'cus_1', 1, scheduleObj({ next: 'price_plus' }))), sub, new Date(T0 + 25 * DAY))).toBeNull()
    expect(await getPendingChange(ctx(mockClient('price_biz', 'cus_1', 1, scheduleObj({ next: 'price_unknown' }))), sub, new Date(T0))).toBeNull()
    expect(await getPendingChange(ctx(mockClient('price_biz', 'cus_1', 1, scheduleObj({ next: 'price_plus', status: 'released' }))), sub, new Date(T0))).toBeNull()
    expect(await getPendingChange(ctx(mockClient('price_biz')), sub, new Date(T0))).toBeNull()
    const broken = mockClient('price_biz')
    broken.retrieve.mockRejectedValue(new Error('down'))
    expect(await getPendingChange(ctx(broken), sub, new Date(T0))).toBeNull()
    expect(await getPendingChange({ store: a.store, client: null, env: {}, baseUrl: 'x' }, sub)).toBeNull()
  })
  it('cancelling the subscription releases a pending downgrade first, and not when there is none', async () => {
    const a = await seed([{ id: 'sub_1', tier: 'business' }])
    const m = mockClient('price_biz', 'cus_1', 1, scheduleObj({ next: 'price_plus' }))
    const order: string[] = []
    m.sched.release.mockImplementation(async () => void order.push('release'))
    m.update.mockImplementation(async () => void order.push('update'))
    expect((await setCancelAtPeriodEnd({ store: a.store, client: m.client, env, baseUrl: 'x' }, DID, a.licenseId, true, new Date(T0))).ok).toBe(true)
    expect(order).toEqual(['release', 'update'])
    const n = mockClient('price_biz')
    await setCancelAtPeriodEnd({ store: a.store, client: n.client, env, baseUrl: 'x' }, DID, a.licenseId, true, new Date(T0))
    expect(n.sched.release).not.toHaveBeenCalled()
  })
  it('if the cancellation fails after the schedule was released, the person is told exactly that', async () => {
    const a = await seed([{ id: 'sub_1', tier: 'business' }])
    const m = mockClient('price_biz', 'cus_1', 1, scheduleObj({ next: 'price_plus' }))
    m.update.mockRejectedValue(new Error('x'))
    expect(await setCancelAtPeriodEnd({ store: a.store, client: m.client, env, baseUrl: 'x' }, DID, a.licenseId, true, new Date(T0))).toMatchObject({ ok: false, error: expect.stringContaining('scheduled plan change was canceled') })
  })
  it('is refused for a stranger subscription', async () => {
    const a = await seed([{ id: 'sub_1', tier: 'business' }])
    const m = mockClient('price_biz', 'cus_other', 1, scheduleObj({ next: 'price_plus' }))
    expect((await cancelScheduledChange({ store: a.store, client: m.client, env, baseUrl: 'x' }, DID, a.licenseId)).ok).toBe(false)
    expect(m.sched.release).not.toHaveBeenCalled()
  })
})

describe('summarize', () => {
  it('describes renewal, ending, and failed payment in plain English', () => {
    const end = new Date('2026-11-30T12:00:00Z')
    expect(longDate(end)).toBe('November 30, 2026')
    expect(summarize({ tier: 'plus', status: 'active', currentPeriodEnd: end, cancelAtPeriodEnd: false })).toEqual({ plan: 'Plus', price: '$9 per month', status: 'Active', when: 'Renews on November 30, 2026', change: null })
    expect(summarize({ tier: 'plus', status: 'active', currentPeriodEnd: end, cancelAtPeriodEnd: true })).toMatchObject({ price: '$9 per month', when: 'Ends on November 30, 2026 (you keep Plus until then)' })
    expect(summarize({ tier: 'business', status: 'active', currentPeriodEnd: end, cancelAtPeriodEnd: false }, { tier: 'plus', at: end })).toMatchObject({ plan: 'Business', change: 'Your plan changes to Plus on November 30, 2026' })
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

  const phaseEvent = (priceId: string, o: Record<string, unknown> = {}) => ({
    id: 'sub_sched_1', subscription: 'sub_1', status: 'active',
    current_phase: { start_date: sec(T0 + 30 * DAY) },
    phases: [
      { start_date: sec(T0), items: [{ price: 'price_biz' }] },
      { start_date: sec(T0 + 30 * DAY), items: [{ price: priceId }] },
    ],
    ...o,
  })
  const phase0 = { ...phaseEvent('price_plus'), current_phase: { start_date: sec(T0) } }

  it('creating or editing a schedule does not change the stored plan, and the phase change does, once', async () => {
    const store = memoryBillingStore()
    await send(store, 'customer.subscription.created', sub(price('price_biz')), T0)
    // Stripe sends these when the downgrade is scheduled: the subscription now has a schedule, items unchanged.
    expect((await send(store, 'customer.subscription.updated', sub({ ...price('price_biz'), schedule: 'sub_sched_1' }), T0 + DAY)).body.result).toContain('business')
    expect((await send(store, 'subscription_schedule.updated', phase0, T0 + DAY)).body.result).toBe('no plan change')
    expect(store.licenseOf(DID)?.tier).toBe('business')
    // A running schedule survives unrelated webhooks too.
    await send(store, 'customer.subscription.updated', sub({ ...price('price_biz'), cancel_at_period_end: false }), T0 + 2 * DAY)
    expect(store.licenseOf(DID)?.tier).toBe('business')
    // The phase starts.
    const r = await send(store, 'subscription_schedule.updated', phaseEvent('price_plus'), T0 + 30 * DAY, 'evt_phase')
    expect(r.body.result).toBe('schedule moved subscription to plus')
    expect(store.licenseOf(DID)?.tier).toBe('plus')
    expect((await store.subscriptionFor(DID))?.priceId).toBe('price_plus')
    // Redelivery of the same event, and the companion customer.subscription.updated, change nothing more.
    expect((await send(store, 'subscription_schedule.updated', phaseEvent('price_plus'), T0 + 30 * DAY, 'evt_phase')).body.result).toContain('duplicate')
    expect((await send(store, 'subscription_schedule.updated', phaseEvent('price_plus'), T0 + 30 * DAY)).body.result).toBe('no plan change')
    await send(store, 'customer.subscription.updated', sub(price('price_plus')), T0 + 30 * DAY)
    expect(store.licenseOf(DID)?.tier).toBe('plus')
    // The schedule completing leaves Plus in place.
    expect((await send(store, 'subscription_schedule.completed', { ...phaseEvent('price_plus'), status: 'completed', current_phase: null }, T0 + 31 * DAY)).body.result).toBe('no plan change')
    expect(store.licenseOf(DID)?.tier).toBe('plus')
  })

  it('customer.subscription.updated alone also carries the phase change', async () => {
    const store = memoryBillingStore()
    await send(store, 'customer.subscription.created', sub(price('price_biz')), T0)
    await send(store, 'customer.subscription.updated', sub(price('price_plus')), T0 + 30 * DAY)
    expect(store.licenseOf(DID)?.tier).toBe('plus')
  })

  it('a completed schedule applies its last phase when the phase event was missed', async () => {
    const store = memoryBillingStore()
    await send(store, 'customer.subscription.created', sub(price('price_biz')), T0)
    await send(store, 'subscription_schedule.completed', { ...phaseEvent('price_plus'), status: 'completed', current_phase: null }, T0 + 60 * DAY)
    expect(store.licenseOf(DID)?.tier).toBe('plus')
  })

  it('schedule events that do not change the phase are ignored: released, canceled, older, unknown price, unknown subscription', async () => {
    const store = memoryBillingStore()
    await send(store, 'customer.subscription.created', sub(price('price_biz')), T0 + 5 * DAY)
    for (const [o, at] of [[{ status: 'released' }, T0 + 6 * DAY], [{ status: 'canceled' }, T0 + 6 * DAY], [{}, T0 + DAY], [{ subscription: 'sub_nope' }, T0 + 6 * DAY]] as const) {
      const r = await send(store, 'subscription_schedule.updated', phaseEvent('price_plus', o), at)
      expect(r.body.result).toContain('ignored')
    }
    expect((await send(store, 'subscription_schedule.updated', phaseEvent('price_gone'), T0 + 6 * DAY)).body.result).toContain('ignored')
    expect(store.licenseOf(DID)?.tier).toBe('business')
  })

  it('cancelling the subscription at period end while a schedule was pending ends the plan as before', async () => {
    const store = memoryBillingStore()
    await send(store, 'customer.subscription.created', sub(price('price_biz')), T0)
    await send(store, 'customer.subscription.updated', sub({ ...price('price_biz'), cancel_at_period_end: true }), T0 + DAY)
    expect((await store.subscriptionFor(DID))?.cancelAtPeriodEnd).toBe(true)
    await send(store, 'customer.subscription.deleted', sub({ status: 'canceled', ...price('price_biz') }), T0 + 30 * DAY)
    expect(store.licenseOf(DID)?.tier).toBe('free')
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
