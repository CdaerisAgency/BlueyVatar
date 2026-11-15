import type pg from 'pg'
import { job, type JobFactory } from './jobs/schedule.js'

/** Stripe billing rows are kept this long after a user deletes their data (issue #140, owner decision). */
const BILLING_RETENTION_YEARS = 7

type PurgeResult = { customers: number; subscriptions: number; events: number }

/**
 * Deletes billing rows whose owner deleted their data more than 7 years before `now` (`deleted_at`, set by the web app).
 * `stripe_events` holds only an event id and type, with no DID, so its idempotency rows are deleted 7 years after they were processed.
 */
export async function purgeExpiredBilling(pool: Pick<pg.Pool, 'query'>, now: Date = new Date()): Promise<PurgeResult> {
  const cutoff = `$1::timestamptz - make_interval(years => ${BILLING_RETENTION_YEARS})`
  const subs = await pool.query(`DELETE FROM subscriptions WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}`, [now])
  const cust = await pool.query(`DELETE FROM billing_customers WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}`, [now])
  const ev = await pool.query(`DELETE FROM stripe_events WHERE processed_at < ${cutoff}`, [now])
  return { customers: cust.rowCount ?? 0, subscriptions: subs.rowCount ?? 0, events: ev.rowCount ?? 0 }
}

/** Deletes Stripe billing rows 7 years after their owner deleted their data. Runs now and then daily. */
export const billingPurgeJob: JobFactory = (pool) => job({
  name: 'billing_retention_purge', everyMs: 24 * 60 * 60 * 1000, run: () => purgeExpiredBilling(pool),
  summarize: (r) => (r.customers || r.subscriptions || r.events) && r,
})
