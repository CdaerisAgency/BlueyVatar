import { randomUUID } from 'node:crypto'
import { ENTITLEMENTS, normalizePaidPlan, normalizeTier, plusEntitled, storedLicenseTier, type PaidPlan, type SubscriptionStatus, type Tier } from '@blueyvatar/core'
import type pg from 'pg'
import { getPool } from '../store'

export interface SubscriptionRow {
  id: string
  customerId: string
  did: string
  licenseId: string
  priceId: string
  tier: PaidPlan
  status: SubscriptionStatus
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  pastDueSince: Date | null
  /** Stripe `created` of the newest event applied. */
  lastEventAt: Date
}

export interface LicenseState {
  tier: Tier
  status: 'active' | 'past_due'
  graceEndsAt: Date | null
}

export interface LicenseRef {
  licenseId: string
  tier: Tier
}

/** Operations available inside one webhook event's transaction. */
export interface BillingTx {
  /** The DID's license, issuing a Free one when none exists (same rule as the dashboard). */
  ensureLicense(did: string): Promise<LicenseRef>
  /** A license the DID owns, by id: their personal one or an organization license they are the billing owner of (issue #180). Null if it does not exist or belongs to someone else. */
  ownedLicense(did: string, licenseId: string): Promise<LicenseRef | null>
  linkCustomer(did: string, licenseId: string, customerId: string): Promise<void>
  didForCustomer(customerId: string): Promise<string | null>
  /** True when the DID deleted their data and has not started a new checkout since (issue #140). Their late events must not rebuild a license. */
  isDeleted(did: string): Promise<boolean>
  getSubscription(id: string): Promise<SubscriptionRow | null>
  putSubscription(row: SubscriptionRow): Promise<void>
  subscriptionsForLicense(licenseId: string): Promise<SubscriptionRow[]>
  /** Writes the derived tier, status, and grace end, plus the tier's entitlement copy. Enterprise licenses are left alone. */
  applyLicense(licenseId: string, state: LicenseState): Promise<void>
}

export interface BillingStore {
  /**
   * Runs `fn` once per event id. The event id is recorded in the same transaction as `fn`'s writes, so a failure
   * leaves it unrecorded and Stripe's retry runs again, while a concurrent or repeated delivery returns 'duplicate'.
   */
  process(eventId: string, type: string, fn: (tx: BillingTx) => Promise<void>): Promise<'processed' | 'duplicate'>
  customerFor(did: string): Promise<string | null>
  /** The newest entitled subscription. With `licenseId`, only that license's subscriptions, so an organization license and a personal one each hold their own. */
  subscriptionFor(did: string, licenseId?: string): Promise<SubscriptionRow | null>
  /** True when the DID holds a subscription that entitles the Plus user plan at `now`: Plus or Business on their own license (active, trialing, or past due inside the grace period). */
  hasPlus(did: string, now?: Date): Promise<boolean>
}

const newLicenseId = () => `lic_${randomUUID()}`
const ENTITLED = new Set(['active', 'trialing', 'past_due'])

/** In-memory store for tests and development without a database. Not safe across processes. */
export function memoryBillingStore() {
  const events = new Set<string>()
  const licenses = new Map<string, LicenseRef & { owner: string; status: string; graceEndsAt: Date | null; entitlements: unknown }>()
  const customers = new Map<string, string>()
  const subs = new Map<string, SubscriptionRow>()
  const tx: BillingTx = {
    async ensureLicense(did) {
      let l = [...licenses.values()].find((x) => x.owner === did)
      if (!l) {
        l = { licenseId: newLicenseId(), owner: did, tier: 'free', status: 'active', graceEndsAt: null, entitlements: ENTITLEMENTS.free }
        licenses.set(l.licenseId, l)
      }
      return { licenseId: l.licenseId, tier: l.tier }
    },
    async ownedLicense(did, licenseId) {
      const l = licenses.get(licenseId)
      return l && l.owner === did ? { licenseId: l.licenseId, tier: l.tier } : null
    },
    async linkCustomer(did, _licenseId, customerId) {
      customers.set(did, customerId)
    },
    async didForCustomer(customerId) {
      return [...customers].find(([, c]) => c === customerId)?.[0] ?? null
    },
    async isDeleted() {
      return false
    },
    async getSubscription(id) {
      return subs.get(id) ?? null
    },
    async putSubscription(row) {
      subs.set(row.id, { ...row })
    },
    async subscriptionsForLicense(licenseId) {
      return [...subs.values()].filter((s) => s.licenseId === licenseId)
    },
    async applyLicense(licenseId, state) {
      const l = licenses.get(licenseId)
      if (!l || l.tier === 'enterprise') return
      Object.assign(l, { tier: state.tier, status: state.status, graceEndsAt: state.graceEndsAt, entitlements: ENTITLEMENTS[state.tier] })
    },
  }
  const store: BillingStore & {
    /** Test inspection. */
    licenseOf(did: string): { tier: Tier; status: string; graceEndsAt: Date | null; entitlements: unknown } | undefined
    seedLicense(did: string, tier: Tier): void
    eventCount(): number
  } = {
    async process(eventId, _type, fn) {
      if (events.has(eventId)) return 'duplicate'
      // No rollback in memory: callers throw before writing when they cannot finish.
      await fn(tx)
      events.add(eventId)
      return 'processed'
    },
    async customerFor(did) {
      return customers.get(did) ?? null
    },
    async subscriptionFor(did, licenseId) {
      return [...subs.values()].filter((s) => s.did === did && (!licenseId || s.licenseId === licenseId) && ENTITLED.has(s.status)).sort((a, b) => b.lastEventAt.getTime() - a.lastEventAt.getTime())[0] ?? null
    },
    async hasPlus(did, now = new Date()) {
      return plusEntitled([...subs.values()].filter((s) => s.did === did), now)
    },
    licenseOf: (did) => [...licenses.values()].find((x) => x.owner === did),
    seedLicense(did, tier) {
      const id = newLicenseId()
      licenses.set(id, { licenseId: id, owner: did, tier, status: 'active', graceEndsAt: null, entitlements: ENTITLEMENTS[tier] })
    },
    eventCount: () => events.size,
  }
  return store
}

const subCols = `stripe_subscription_id, stripe_customer_id, did, license_id, price_id, tier, status,
  current_period_end, cancel_at_period_end, past_due_since, last_event_at`
const toSub = (r: Record<string, unknown>): SubscriptionRow => ({
  id: r.stripe_subscription_id as string,
  customerId: r.stripe_customer_id as string,
  did: r.did as string,
  licenseId: r.license_id as string,
  priceId: r.price_id as string,
  tier: normalizePaidPlan(r.tier) ?? 'plus',
  status: r.status as SubscriptionStatus,
  currentPeriodEnd: (r.current_period_end as Date | null) ?? null,
  cancelAtPeriodEnd: r.cancel_at_period_end as boolean,
  pastDueSince: (r.past_due_since as Date | null) ?? null,
  lastEventAt: r.last_event_at as Date,
})

function pgTx(c: pg.PoolClient): BillingTx {
  return {
    async ensureLicense(did) {
      // Same per-owner lock the dashboard uses, so a first dashboard visit and a first webhook cannot both issue a license.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`license:${did}`])
      const r = await c.query('SELECT license_id, tier FROM licenses WHERE owner = $1 AND org_id IS NULL ORDER BY created_at LIMIT 1', [did])
      if (r.rows[0]) return { licenseId: r.rows[0].license_id, tier: normalizeTier(r.rows[0].tier) }
      const id = newLicenseId()
      await c.query(
        `INSERT INTO licenses (license_id, owner, tier, status, term, entitlements)
         VALUES ($1, $2, 'free', 'active', 'monthly', $3)`,
        [id, did, JSON.stringify(ENTITLEMENTS.free)],
      )
      return { licenseId: id, tier: 'free' as const }
    },
    async ownedLicense(did, licenseId) {
      const r = await c.query('SELECT license_id, tier FROM licenses WHERE license_id = $1 AND owner = $2', [licenseId, did])
      return r.rows[0] ? { licenseId: r.rows[0].license_id, tier: normalizeTier(r.rows[0].tier) } : null
    },
    async linkCustomer(did, licenseId, customerId) {
      await c.query(
        `INSERT INTO billing_customers (did, license_id, stripe_customer_id) VALUES ($1, $2, $3)
         ON CONFLICT (did) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, deleted_at = NULL,
           -- One customer per DID serves the personal license and any organization license, so a live row keeps its license id.
           license_id = CASE WHEN billing_customers.deleted_at IS NOT NULL THEN EXCLUDED.license_id ELSE billing_customers.license_id END`,
        [did, licenseId, customerId],
      )
    },
    async didForCustomer(customerId) {
      return (await c.query('SELECT did FROM billing_customers WHERE stripe_customer_id = $1', [customerId])).rows[0]?.did ?? null
    },
    async isDeleted(did) {
      return ((await c.query('SELECT 1 FROM billing_customers WHERE did = $1 AND deleted_at IS NOT NULL', [did])).rowCount ?? 0) > 0
    },
    async getSubscription(id) {
      const r = await c.query(`SELECT ${subCols} FROM subscriptions WHERE stripe_subscription_id = $1 FOR UPDATE`, [id])
      return r.rows[0] ? toSub(r.rows[0]) : null
    },
    async putSubscription(s) {
      await c.query(
        `INSERT INTO subscriptions (${subCols}, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         ON CONFLICT (stripe_subscription_id) DO UPDATE SET
           stripe_customer_id = EXCLUDED.stripe_customer_id, did = EXCLUDED.did, license_id = EXCLUDED.license_id,
           price_id = EXCLUDED.price_id, tier = EXCLUDED.tier, status = EXCLUDED.status,
           current_period_end = EXCLUDED.current_period_end, cancel_at_period_end = EXCLUDED.cancel_at_period_end,
           past_due_since = EXCLUDED.past_due_since, last_event_at = EXCLUDED.last_event_at, updated_at = now()`,
        [s.id, s.customerId, s.did, s.licenseId, s.priceId, s.tier, s.status, s.currentPeriodEnd, s.cancelAtPeriodEnd, s.pastDueSince, s.lastEventAt],
      )
    },
    async subscriptionsForLicense(licenseId) {
      return (await c.query(`SELECT ${subCols} FROM subscriptions WHERE license_id = $1`, [licenseId])).rows.map(toSub)
    },
    async applyLicense(licenseId, s) {
      await c.query(
        `UPDATE licenses SET tier = $2, status = $3, grace_ends_at = $4, term = 'monthly',
           entitlements = $5
         WHERE license_id = $1 AND tier <> 'enterprise'`,
        [licenseId, storedLicenseTier(s.tier), s.status, s.graceEndsAt, JSON.stringify(ENTITLEMENTS[s.tier])],
      )
    },
  }
}

export function postgresBillingStore(pool: pg.Pool): BillingStore {
  return {
    async process(eventId, type, fn) {
      const c = await pool.connect()
      try {
        await c.query('BEGIN')
        // A concurrent delivery of the same event blocks on this insert until we commit, then sees the conflict.
        const ins = await c.query('INSERT INTO stripe_events (event_id, type) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING', [eventId, type])
        if ((ins.rowCount ?? 0) === 0) {
          await c.query('ROLLBACK')
          return 'duplicate'
        }
        await fn(pgTx(c))
        await c.query('COMMIT')
        return 'processed'
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {})
        throw e
      } finally {
        c.release()
      }
    },
    async customerFor(did) {
      return (await pool.query('SELECT stripe_customer_id FROM billing_customers WHERE did = $1', [did])).rows[0]?.stripe_customer_id ?? null
    },
    async subscriptionFor(did, licenseId) {
      const r = await pool.query(
        `SELECT ${subCols} FROM subscriptions WHERE did = $1 AND ($2::text IS NULL OR license_id = $2)
           AND status IN ('active', 'trialing', 'past_due') ORDER BY last_event_at DESC LIMIT 1`,
        [did, licenseId ?? null],
      )
      return r.rows[0] ? toSub(r.rows[0]) : null
    },
    async hasPlus(did, now = new Date()) {
      // An organization's Business subscription is billed to its owner but does not give the owner's own account Plus.
      const r = await pool.query(
        `SELECT ${subCols} FROM subscriptions WHERE did = $1 AND status IN ('active', 'trialing', 'past_due')
           AND (tier IN ('plus', 'pro') OR license_id IN (SELECT license_id FROM licenses WHERE owner = $1 AND org_id IS NULL))`,
        [did],
      )
      return plusEntitled(r.rows.map(toSub), now)
    },
  }
}

const g = globalThis as { __bvBilling?: BillingStore }

export function getBillingStore(): BillingStore {
  const pool = getPool()
  g.__bvBilling ??= pool ? postgresBillingStore(pool) : memoryBillingStore()
  return g.__bvBilling
}
