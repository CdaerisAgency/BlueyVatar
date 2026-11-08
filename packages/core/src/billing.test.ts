import { describe, expect, it } from 'vitest'
import { PAID_PLANS, PAID_TIERS, PAST_DUE_GRACE_DAYS, PAST_DUE_GRACE_MS, effectiveTier, entitles, graceEndsAt, isPaidTier, normalizePaidPlan, normalizeTier, entitlementsFor, ENTITLEMENTS, TIERS, storedLicenseTier, plusEntitled, resolveLicenseBilling, type SubscriptionFacts } from './index.js'

const T0 = new Date('2026-11-01T00:00:00Z')
const day = 24 * 60 * 60 * 1000
const sub = (o: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({ tier: 'plus', status: 'active', pastDueSince: null, ...o })

describe('grace period', () => {
  it('is a proposed 7 days', () => {
    expect(PAST_DUE_GRACE_DAYS).toBe(7)
    expect(PAST_DUE_GRACE_MS).toBe(7 * day)
    expect(graceEndsAt(T0).getTime()).toBe(T0.getTime() + 7 * day)
  })
  it('entitles a past-due subscription until the grace period ends, then not', () => {
    const s = sub({ status: 'past_due', pastDueSince: T0 })
    expect(entitles(s, new Date(T0.getTime() + 7 * day - 1))).toBe(true)
    expect(entitles(s, new Date(T0.getTime() + 7 * day))).toBe(false)
  })
  it('does not entitle a past-due subscription with no start time', () => {
    expect(entitles(sub({ status: 'past_due' }), T0)).toBe(false)
  })
})

describe('resolveLicenseBilling', () => {
  it('is Free with no subscriptions', () => {
    expect(resolveLicenseBilling([], T0)).toEqual({ tier: 'free', status: 'active', graceEndsAt: null })
  })
  it.each(['active', 'trialing'] as const)('maps %s to the subscription tier', (status) => {
    expect(resolveLicenseBilling([sub({ tier: 'business', status })], T0)).toEqual({ tier: 'business', status: 'active', graceEndsAt: null })
  })
  it.each(['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'] as const)('maps %s to Free', (status) => {
    expect(resolveLicenseBilling([sub({ status })], T0).tier).toBe('free')
  })
  it('keeps the paid tier while past due in grace, with the grace end', () => {
    const r = resolveLicenseBilling([sub({ status: 'past_due', pastDueSince: T0 })], new Date(T0.getTime() + 3 * day))
    expect(r).toEqual({ tier: 'plus', status: 'past_due', graceEndsAt: new Date(T0.getTime() + 7 * day) })
  })
  it('drops to Free once the grace period has expired', () => {
    expect(resolveLicenseBilling([sub({ status: 'past_due', pastDueSince: T0 })], new Date(T0.getTime() + 8 * day))).toEqual({ tier: 'free', status: 'active', graceEndsAt: null })
  })
  it('picks the highest entitling tier and ignores dead subscriptions', () => {
    const r = resolveLicenseBilling([sub({ tier: 'plus' }), sub({ tier: 'business', status: 'canceled' }), sub({ tier: 'business', status: 'active' })], T0)
    expect(r.tier).toBe('business')
    expect(resolveLicenseBilling([sub({ tier: 'plus' }), sub({ tier: 'business', status: 'canceled' })], T0).tier).toBe('plus')
  })
  it('prefers a healthy subscription over a past-due one of the same tier', () => {
    const r = resolveLicenseBilling([sub({ status: 'past_due', pastDueSince: T0 }), sub()], new Date(T0.getTime() + day))
    expect(r.status).toBe('active')
  })
})

describe('effectiveTier', () => {
  it('serves the stored tier for an active license', () => {
    expect(effectiveTier({ tier: 'plus', status: 'active' }, T0)).toBe('plus')
    expect(effectiveTier({ tier: 'pro', status: 'active' }, T0)).toBe('plus')
  })
  it('serves a past-due license until its grace end, then Free', () => {
    const l = { tier: 'business' as const, status: 'past_due', graceEndsAt: new Date(T0.getTime() + 7 * day) }
    expect(effectiveTier(l, new Date(T0.getTime() + 6 * day))).toBe('business')
    expect(effectiveTier(l, new Date(T0.getTime() + 7 * day))).toBe('free')
  })
  it('never changes Enterprise', () => {
    expect(effectiveTier({ tier: 'enterprise', status: 'past_due', graceEndsAt: T0 }, new Date(T0.getTime() + 30 * day))).toBe('enterprise')
  })
})

describe('Plus plan', () => {
  const plus = (o: { status?: SubscriptionFacts['status']; pastDueSince?: Date | null } = {}) => ({ tier: 'plus', status: o.status ?? 'active', pastDueSince: o.pastDueSince ?? null })
  it('Plus and Business are sold; Pro is a retired alias of Plus', () => {
    expect(PAID_PLANS).toEqual(['plus', 'business'])
    expect(PAID_TIERS).toEqual(['plus', 'business'])
    expect(isPaidTier('plus')).toBe(true)
    expect(isPaidTier('pro')).toBe(false)
    expect(normalizePaidPlan('pro')).toBe('plus')
    expect(normalizePaidPlan('free')).toBeNull()
    expect(normalizeTier('pro')).toBe('plus')
    expect(normalizeTier('nonsense')).toBe('free')
    expect(entitlementsFor('pro')).toBe(ENTITLEMENTS.plus)
  })
  it('Plus combines the old Plus and Pro limits and does not lower any', () => {
    expect(ENTITLEMENTS.plus).toMatchObject({ maxImages: 20, keyedMonthly: 50_000, hovercards: true, maxSize: 1024 })
    expect(ENTITLEMENTS.business.maxImages).toBeGreaterThanOrEqual(20)
    expect(ENTITLEMENTS.business.keyedMonthly).toBe(1_000_000)
    expect(ENTITLEMENTS.free.maxImages).toBe(3)
    expect(storedLicenseTier('plus')).toBe('plus')
    for (const t of TIERS) expect(storedLicenseTier(t)).toBe(t)
    expect(storedLicenseTier(normalizeTier('pro'))).toBe('plus')
  })
  it('a stored pro subscription resolves to the Plus license tier', () => {
    expect(resolveLicenseBilling([sub({ tier: 'pro' })], T0).tier).toBe('plus')
  })
  it.each(['active', 'trialing'] as const)('entitles %s', (status) => {
    expect(plusEntitled([plus({ status })], T0)).toBe(true)
  })
  it.each(['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'] as const)('does not entitle %s', (status) => {
    expect(plusEntitled([plus({ status })], T0)).toBe(false)
  })
  it('keeps Plus through the past-due grace period, then ends it', () => {
    const s = plus({ status: 'past_due', pastDueSince: T0 })
    expect(plusEntitled([s], new Date(T0.getTime() + 7 * day - 1))).toBe(true)
    expect(plusEntitled([s], new Date(T0.getTime() + 7 * day))).toBe(false)
  })
  it('Business and the retired pro name also entitle Plus', () => {
    expect(plusEntitled([{ tier: 'pro', status: 'active', pastDueSince: null }], T0)).toBe(true)
    expect(plusEntitled([{ tier: 'business', status: 'active', pastDueSince: null }], T0)).toBe(true)
    expect(plusEntitled([{ tier: 'enterprise', status: 'active', pastDueSince: null }], T0)).toBe(false)
    expect(plusEntitled([], T0)).toBe(false)
  })
})
