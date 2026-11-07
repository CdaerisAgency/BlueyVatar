import type pg from 'pg'

/** Stripe billing rows are kept this long after a user deletes their data (issue #140, owner decision). */
export const BILLING_RETENTION_YEARS = 7

export type PurgeResult = { customers: number; subscriptions: number; events: number }

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

/** Runs the purge now and then daily. Failures are logged and retried on the next tick. */
export function scheduleBillingPurge(pool: Pick<pg.Pool, 'query'>, everyMs = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  const run = () =>
    purgeExpiredBilling(pool)
      .then((r) => (r.customers || r.subscriptions || r.events) && console.log('billing retention purge', JSON.stringify(r)))
      .catch((err) => console.error('billing retention purge failed', err instanceof Error ? err.message : 'unknown'))
  void run()
  const timer = setInterval(run, everyMs)
  timer.unref()
  return timer
}
