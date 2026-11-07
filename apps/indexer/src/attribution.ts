import type { Pool } from 'pg'
import { attributionNotice, checkAttribution, safeFetch, type AttributionResult, type Fetcher, type Notifier } from '@blueyvatar/core/verification'
import { errors, log } from './obs.js'

/**
 * Free-tier attribution check (issue #182, spec section 12). Fetches each declared production site and records
 * whether a followable link to blueyvatar.com is on the page. Report only: this never revokes or downgrades anything.
 */
export type DueSite = {
  hash: string
  did: string
  site: string
  /** True once the failure email went out for the current streak. */
  notified: boolean
}

export interface AttributionStore {
  /** Declared sites on active Free licenses that were not checked since `checkedBefore`, never-checked first. */
  due(checkedBefore: Date, limit: number): Promise<DueSite[]>
  /** Stores the result and the check time. A `found` result also clears the notified flag. */
  record(hash: string, result: AttributionResult, at: Date): Promise<void>
  markNotified(hash: string, at: Date): Promise<void>
}

/** Sends the failure email. Resolves true when the owner was dealt with (sent, or off, or no address) and false to retry next pass. */
export type NotifyFailure = (c: DueSite, result: 'nofollow' | 'missing') => Promise<boolean>

export type AttributionOptions = {
  minGapMs: number
  batchSize: number
  batchDelayMs: number
  now: () => Date
  sleep: (ms: number) => Promise<void>
}

export const defaultAttributionOptions: AttributionOptions = {
  minGapMs: 20 * 3_600_000,
  batchSize: 50,
  batchDelayMs: 2_000,
  now: () => new Date(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

export type AttributionDeps = { store: AttributionStore; check: (site: string) => Promise<AttributionResult>; notify: NotifyFailure }
export type AttributionRunResult = { checked: number; found: number; failed: number; unreachable: number; notified: number }

/** One pass over every due site, in batches. A site that throws is logged and left for the next pass. */
export async function checkAttributionDue(deps: AttributionDeps, opts: Partial<AttributionOptions> = {}): Promise<AttributionRunResult> {
  const o = { ...defaultAttributionOptions, ...opts }
  const out: AttributionRunResult = { checked: 0, found: 0, failed: 0, unreachable: 0, notified: 0 }
  const checkedBefore = new Date(o.now().getTime() - o.minGapMs)
  for (let first = true; ; first = false) {
    const batch = await deps.store.due(checkedBefore, o.batchSize)
    if (batch.length === 0) break
    if (!first) await o.sleep(o.batchDelayMs)
    let stuck = 0
    for (const c of batch) {
      try {
        out.checked++
        const result = await deps.check(c.site)
        await deps.store.record(c.hash, result, o.now())
        if (result === 'found') out.found++
        else if (result === 'unreachable') out.unreachable++
        else {
          out.failed++
          if (!c.notified && (await deps.notify(c, result as 'nofollow' | 'missing').catch((e) => (log.error('attribution notice failed', { err: e }), false)))) {
            await deps.store.markNotified(c.hash, o.now())
            out.notified++
          }
        }
      } catch (err) {
        stuck++
        log.error('attribution check failed for one key', { err })
        errors.captureException(err, { tags: { task: 'attribution_check' } })
      }
    }
    if (stuck > 0 || batch.length < o.batchSize) break
  }
  return out
}

export function pgAttributionStore(pool: Pick<Pool, 'query'>): AttributionStore {
  return {
    async due(checkedBefore, limit) {
      const r = await pool.query(
        `SELECT k.key_hash, k.attribution_site, k.attribution_notified_at, l.owner
           FROM api_keys k
           JOIN licenses l ON l.license_id = k.license_id
          WHERE k.attribution_site IS NOT NULL
            AND k.revoked_at IS NULL
            AND k.kind = 'publishable'
            AND l.attribution_required
            AND l.status = 'active'
            AND (k.attribution_checked_at IS NULL OR k.attribution_checked_at < $1)
          ORDER BY k.attribution_checked_at NULLS FIRST
          LIMIT $2`,
        [checkedBefore, limit],
      )
      return r.rows.map((x) => ({ hash: x.key_hash, did: x.owner, site: x.attribution_site, notified: x.attribution_notified_at != null }))
    },
    async record(hash, result, at) {
      await pool.query(
        `UPDATE api_keys
            SET attribution_result = $2, attribution_checked_at = $3,
                attribution_notified_at = CASE WHEN $2 = 'found' THEN NULL ELSE attribution_notified_at END
          WHERE key_hash = $1`,
        [hash, result, at],
      )
    },
    async markNotified(hash, at) {
      await pool.query('UPDATE api_keys SET attribution_notified_at = $2 WHERE key_hash = $1', [hash, at])
    },
  }
}

/** Builds the failure notice sender on the shared Notifier, which honors the owner's preferences and never logs an address. */
export function notifyWith(notifier: Pick<Notifier, 'send'>, publicUrl: string): NotifyFailure {
  return async (c, result) => {
    const r = await notifier.send(c.did, 'billing', attributionNotice({ did: c.did, site: c.site, result, publicUrl }))
    return r !== 'failed'
  }
}

export function attributionFromEnv(env: Record<string, string | undefined> = process.env, f: Fetcher = safeFetch) {
  return {
    check: (site: string) => checkAttribution(site, f),
    everyMs: Number(env.ATTRIBUTION_INTERVAL_HOURS ?? 24) * 3_600_000,
  }
}

/** Runs a pass on an interval, never overlapping itself. Failures are logged and retried on the next tick. */
export function scheduleAttribution(run: () => Promise<AttributionRunResult>, everyMs: number): NodeJS.Timeout {
  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    run()
      .then((r) => r.checked > 0 && log.info('attribution pass', { ...r }))
      .catch((err) => { log.error('attribution pass failed', { err }); errors.captureException(err, { tags: { task: 'attribution_pass' } }) })
      .finally(() => { running = false })
  }, everyMs)
  timer.unref()
  return timer
}
