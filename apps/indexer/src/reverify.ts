import type { Pool } from 'pg'
import type { VerifyOutcome } from '@blueyvatar/core/verification'
import { errors, log } from './obs.js'

/** Consecutive failed re-checks that revoke an attestation. */
export const MAX_FAILS = 3

export type DueClaim = {
  uri: string
  did: string
  rkey: string
  method: string
  platform: string
  claimUri: string
  handle: string | null
  failCount: number
}

export interface ReverifyStore {
  /** Attested claims whose last success is before `verifiedBefore` and that were not checked since `checkedBefore`. */
  due(verifiedBefore: Date, checkedBefore: Date, limit: number): Promise<DueClaim[]>
  /** Success: resets fail_count and restarts the 30-day window. */
  recordSuccess(uri: string, at: Date): Promise<void>
  /** Failure: increments fail_count and returns the new count. */
  recordFailure(uri: string, at: Date): Promise<number>
  /** Inconclusive check (network, 5xx, no handle): stamps last_checked_at only. */
  recordInconclusive(uri: string, at: Date): Promise<void>
  /** Marks the attestation row revoked so delivery and the profile stop counting it. */
  markRevoked(uri: string): Promise<void>
}

export type Verifier = (claim: DueClaim) => Promise<VerifyOutcome>
/** Deletes the attestation record from the service repo. Throws when it could not. */
export type Remover = (attestationUri: string) => Promise<void>
/** Called once per revocation, after it succeeded. Failures are logged and never retried. */
export type OnRevoked = (claim: DueClaim, reason: string) => Promise<void>

export type ReverifyOptions = {
  afterMs: number
  /** Skip claims checked more recently than this, so a short timer never double-counts a failure. */
  minGapMs: number
  batchSize: number
  batchDelayMs: number
  now: () => Date
  sleep: (ms: number) => Promise<void>
}

export const DAY_MS = 86_400_000
export const defaultOptions: ReverifyOptions = {
  afterMs: 30 * DAY_MS,
  minGapMs: 20 * 3_600_000,
  batchSize: 50,
  batchDelayMs: 2_000,
  now: () => new Date(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

export type ReverifyDeps = { store: ReverifyStore; verify: Verifier; remove: Remover; onRevoked: OnRevoked }
export type ReverifyResult = { checked: number; ok: number; failed: number; inconclusive: number; revoked: number }

/** One pass over every due claim, in batches. A claim that throws is logged and left for the next pass. */
export async function reverifyDue(deps: ReverifyDeps, opts: Partial<ReverifyOptions> = {}): Promise<ReverifyResult> {
  const o = { ...defaultOptions, ...opts }
  const out: ReverifyResult = { checked: 0, ok: 0, failed: 0, inconclusive: 0, revoked: 0 }
  const start = o.now()
  const verifiedBefore = new Date(start.getTime() - o.afterMs)
  const checkedBefore = new Date(start.getTime() - o.minGapMs)
  for (let first = true; ; first = false) {
    // Every row handled below gets a fresh last_checked_at, so it drops out of the next query.
    const batch = await deps.store.due(verifiedBefore, checkedBefore, o.batchSize)
    if (batch.length === 0) break
    if (!first) await o.sleep(o.batchDelayMs)
    let stuck = 0
    for (const c of batch) {
      try {
        await checkOne(c, deps, o, out)
      } catch (err) {
        stuck++
        log.error('reverify failed for one claim', { err })
        errors.captureException(err, { tags: { task: 'reverify_claim' } })
      }
    }
    // Rows that threw were not stamped. Stop rather than loop on them forever.
    if (stuck > 0 || batch.length < o.batchSize) break
  }
  return out
}

async function checkOne(c: DueClaim, d: ReverifyDeps, o: ReverifyOptions, out: ReverifyResult): Promise<void> {
  out.checked++
  const r = await d.verify(c)
  const at = o.now()
  if (r.ok) {
    out.ok++
    await d.store.recordSuccess(c.uri, at)
    return
  }
  if (r.transient) {
    out.inconclusive++
    await d.store.recordInconclusive(c.uri, at)
    return
  }
  out.failed++
  const fails = await d.store.recordFailure(c.uri, at)
  if (fails < MAX_FAILS) return
  // If the repo delete fails this throws, the row stays verified with fail_count >= 3, and the
  // next pass retries the revocation (a later failure keeps the count at 3 or more).
  await d.remove(c.uri)
  await d.store.markRevoked(c.uri)
  out.revoked++
  await d.onRevoked(c, r.reason).catch((e) => log.error('revocation notice failed', { err: e }))
}

export function pgReverifyStore(pool: Pool): ReverifyStore {
  return {
    async due(verifiedBefore, checkedBefore, limit) {
      const r = await pool.query(
        `SELECT a.uri, a.claim_did, a.claim_rkey, a.method, a.fail_count, c.platform, c.uri AS claim_uri, r.handle
           FROM attestations a
           JOIN claims c ON c.did = a.claim_did AND c.rkey = a.claim_rkey
           LEFT JOIN repos r ON r.did = a.claim_did
          WHERE a.result = 'verified'
            AND a.verified_at < $1
            AND (a.last_checked_at IS NULL OR a.last_checked_at < $2)
            AND (a.claim_uri IS NULL OR a.claim_uri = c.uri)
          ORDER BY a.verified_at
          LIMIT $3`,
        [verifiedBefore, checkedBefore, limit],
      )
      return r.rows.map((x) => ({
        uri: x.uri, did: x.claim_did, rkey: x.claim_rkey, method: x.method ?? '', platform: x.platform ?? '',
        claimUri: x.claim_uri ?? '', handle: x.handle ?? null, failCount: x.fail_count,
      }))
    },
    async recordSuccess(uri, at) {
      await pool.query(`UPDATE attestations SET verified_at = $2, last_checked_at = $2, fail_count = 0 WHERE uri = $1`, [uri, at])
    },
    async recordFailure(uri, at) {
      const r = await pool.query(`UPDATE attestations SET last_checked_at = $2, fail_count = fail_count + 1 WHERE uri = $1 RETURNING fail_count`, [uri, at])
      return r.rows[0]?.fail_count ?? 0
    },
    async recordInconclusive(uri, at) {
      await pool.query(`UPDATE attestations SET last_checked_at = $2 WHERE uri = $1`, [uri, at])
    },
    async markRevoked(uri) {
      await pool.query(`UPDATE attestations SET result = 'revoked' WHERE uri = $1`, [uri])
    },
  }
}

export type Timers = { setInterval: typeof setInterval }

/** Runs a pass on an interval, never overlapping itself. Failures are logged and retried on the next tick. */
export function scheduleReverify(run: () => Promise<ReverifyResult>, everyMs: number, timers: Timers = { setInterval }): NodeJS.Timeout {
  let running = false
  const timer = timers.setInterval(() => {
    if (running) return
    running = true
    run()
      .then((r) => r.checked > 0 && log.info('reverify pass', { ...r }))
      .catch((err) => { log.error('reverify pass failed', { err }); errors.captureException(err, { tags: { task: 'reverify_pass' } }) })
      .finally(() => { running = false })
  }, everyMs)
  timer.unref()
  return timer
}
