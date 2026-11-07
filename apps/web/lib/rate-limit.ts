import { createHash, timingSafeEqual } from 'node:crypto'
import type pg from 'pg'

/**
 * Shared limiter for the web app's expensive or abusable routes (issue 151, spec sections 9, 12 and 13).
 * Counts live in the same `rate_windows` table that delivery uses, so every web instance shares them.
 * Bucket keys are prefixed `web:` and carry only a salted hash of the IP or DID, never the raw value.
 */

export type BucketConfig = { limit: number; windowSec: number }

const MIN = 60
const HOUR = 3600

/**
 * One entry per bucket. The suffix says who is counted: `.ip` is the hashed client IP, `.did` the signed-in account.
 * `Fail` buckets count failures only and drive a short lockout (see `isLockedOut`).
 */
export const BUCKETS = {
  'login.ip': { limit: 20, windowSec: 10 * MIN },
  'login.did': { limit: 10, windowSec: 10 * MIN },
  'loginFail.ip': { limit: 10, windowSec: 15 * MIN },
  'callback.ip': { limit: 60, windowSec: 10 * MIN },
  'import.did': { limit: 20, windowSec: 10 * MIN },
  'import.ip': { limit: 60, windowSec: 10 * MIN },
  'claimAdd.did': { limit: 30, windowSec: HOUR },
  'claimVerify.did': { limit: 30, windowSec: HOUR },
  'claimVerify.ip': { limit: 60, windowSec: HOUR },
  'domain.did': { limit: 20, windowSec: HOUR },
  'domain.ip': { limit: 40, windowSec: HOUR },
  'domainRefresh.did': { limit: 60, windowSec: 10 * MIN },
  'upload.did': { limit: 30, windowSec: HOUR },
  'upload.ip': { limit: 90, windowSec: HOUR },
  'key.did': { limit: 20, windowSec: HOUR },
  'key.ip': { limit: 60, windowSec: HOUR },
  'addEmail.did': { limit: 5, windowSec: HOUR },
  'addEmail.ip': { limit: 20, windowSec: HOUR },
  'codeFail.did': { limit: 10, windowSec: HOUR },
  'export.did': { limit: 5, windowSec: HOUR },
  'export.ip': { limit: 20, windowSec: HOUR },
  'deleteData.did': { limit: 5, windowSec: HOUR },
  'deleteData.ip': { limit: 20, windowSec: HOUR },
} as const satisfies Record<string, BucketConfig>

export type BucketName = keyof typeof BUCKETS

export type RateWindow = { count: number; resetAtMs: number }

export interface RateStore {
  /** Counts one hit. A window that has ended starts over at 1. */
  hit(bucket: string, windowSec: number, now: Date): Promise<RateWindow>
  /** Current window without counting, or null when none is open. */
  peek(bucket: string, now: Date): Promise<RateWindow | null>
}

export function pgRateStore(pool: pg.Pool): RateStore {
  return {
    async hit(bucket, windowSec, now) {
      const { rows } = await pool.query<{ count: number; reset: string }>(
        `INSERT INTO rate_windows AS w (bucket, count, reset_at)
              VALUES ($1, 1, $3::timestamptz + make_interval(secs => $2))
         ON CONFLICT (bucket) DO UPDATE SET
              count    = CASE WHEN w.reset_at <= $3::timestamptz THEN 1 ELSE w.count + 1 END,
              reset_at = CASE WHEN w.reset_at <= $3::timestamptz THEN $3::timestamptz + make_interval(secs => $2) ELSE w.reset_at END
         RETURNING count, (extract(epoch FROM reset_at) * 1000)::bigint AS reset`,
        [bucket, windowSec, now],
      )
      return { count: Number(rows[0]!.count), resetAtMs: Number(rows[0]!.reset) }
    },
    async peek(bucket, now) {
      const { rows } = await pool.query<{ count: number; reset: string }>(
        `SELECT count, (extract(epoch FROM reset_at) * 1000)::bigint AS reset FROM rate_windows WHERE bucket = $1 AND reset_at > $2::timestamptz`,
        [bucket, now],
      )
      return rows[0] ? { count: Number(rows[0].count), resetAtMs: Number(rows[0].reset) } : null
    },
  }
}

/** In-process store for development without a database. Counts are lost on restart and not shared. */
export function memoryRateStore(): RateStore {
  const m = new Map<string, RateWindow>()
  return {
    async hit(bucket, windowSec, now) {
      const t = now.getTime()
      const cur = m.get(bucket)
      const next = cur && cur.resetAtMs > t ? { count: cur.count + 1, resetAtMs: cur.resetAtMs } : { count: 1, resetAtMs: t + windowSec * 1000 }
      m.set(bucket, next)
      if (m.size > 10_000) for (const [k, v] of m) if (v.resetAtMs <= t) m.delete(k)
      return next
    },
    async peek(bucket, now) {
      const cur = m.get(bucket)
      return cur && cur.resetAtMs > now.getTime() ? cur : null
    },
  }
}

export type Who = { ip?: string | null; did?: string | null }

export type LimitResult = { ok: true } | { ok: false; bucket: BucketName; retryAfterSec: number }

export function hashSubject(value: string, secret: string): string {
  return createHash('sha256').update(`${secret}\n${value}`).digest('hex')
}

/** Salt for IP and DID hashes. Same variable as the report form, so one secret covers both. */
export const saltSecret = (): string => process.env.REPORT_IP_SECRET ?? process.env.SESSION_SECRET ?? 'blueyvatar'

export const ORIGIN_AUTH_HEADER = 'x-origin-auth'

const equalSecrets = (a: string, b: string): boolean => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * The client IP. `CF-Connecting-IP` is believed only on requests that carry the origin-auth header with the
 * shared secret (spec section 13, Cloudflare item 2); anyone who reaches the origin directly can forge it.
 * Everything else falls back to `Fly-Client-IP`, which Fly's proxy sets itself. With neither, all callers share
 * the bucket `unknown`, which is strict but safe.
 */
export function clientIp(h: { get(name: string): string | null }, originSecret: string | undefined = process.env.ORIGIN_SECRET): string {
  const given = h.get(ORIGIN_AUTH_HEADER)
  if (originSecret && given && equalSecrets(given, originSecret)) {
    const cf = h.get('cf-connecting-ip')?.trim()
    if (cf) return cf
  }
  return h.get('fly-client-ip')?.trim() || 'unknown'
}

function subjectKey(name: BucketName, who: Who, secret: string): string | null {
  const kind = name.slice(name.lastIndexOf('.') + 1) as 'ip' | 'did'
  const value = kind === 'ip' ? who.ip : who.did
  return value ? `web:${name}:${hashSubject(value, secret)}` : null
}

/**
 * Counts one hit against each bucket whose subject is known and reports the first one over its limit.
 * Buckets whose subject is missing (no DID on a public route) are skipped.
 */
export async function checkLimits(store: RateStore, names: readonly BucketName[], who: Who, now = new Date(), secret = saltSecret()): Promise<LimitResult> {
  let worst: LimitResult = { ok: true }
  for (const name of names) {
    const key = subjectKey(name, who, secret)
    if (!key) continue
    const { limit, windowSec } = BUCKETS[name]
    const w = await store.hit(key, windowSec, now)
    if (w.count > limit) {
      const retryAfterSec = Math.max(1, Math.ceil((w.resetAtMs - now.getTime()) / 1000))
      if (worst.ok || retryAfterSec > worst.retryAfterSec) worst = { ok: false, bucket: name, retryAfterSec }
    }
  }
  return worst
}

/** Counts a failure (bad handle, wrong code) toward a lockout bucket. */
export async function recordFailure(store: RateStore, name: BucketName, who: Who, now = new Date(), secret = saltSecret()): Promise<void> {
  const key = subjectKey(name, who, secret)
  if (key) await store.hit(key, BUCKETS[name].windowSec, now)
}

/** True while the bucket holds `limit` failures or more. Does not count anything itself. */
export async function isLockedOut(store: RateStore, name: BucketName, who: Who, now = new Date(), secret = saltSecret()): Promise<LimitResult> {
  const key = subjectKey(name, who, secret)
  if (!key) return { ok: true }
  const w = await store.peek(key, now)
  if (!w || w.count < BUCKETS[name].limit) return { ok: true }
  return { ok: false, bucket: name, retryAfterSec: Math.max(1, Math.ceil((w.resetAtMs - now.getTime()) / 1000)) }
}

/** "5 seconds", "3 minutes", "2 hours": rounded up, so the user is never told to retry too early. */
export function formatRetry(sec: number): string {
  if (sec < 60) return `${Math.max(1, Math.ceil(sec))} second${sec <= 1 ? '' : 's'}`
  if (sec < 3600) {
    const m = Math.ceil(sec / 60)
    return `${m} minute${m === 1 ? '' : 's'}`
  }
  const h = Math.ceil(sec / 3600)
  return `${h} hour${h === 1 ? '' : 's'}`
}

export const limitedMessage = (retryAfterSec: number): string => `Too many requests. Try again in ${formatRetry(retryAfterSec)}.`

/** 429 for route handlers, with `Retry-After` in whole seconds and a short page for browsers. */
export function limitedResponse(retryAfterSec: number): Response {
  const msg = limitedMessage(retryAfterSec)
  return new Response(`<!doctype html><meta charset="utf-8"><title>Too many requests</title><p>${msg}</p><p><a href="/">Back to blueyvatar</a></p>`, {
    status: 429,
    headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': String(retryAfterSec), 'cache-control': 'no-store' },
  })
}
