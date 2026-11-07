import { headers } from 'next/headers'
import { getPool } from './store'
import {
  checkLimits, clientIp, isLockedOut, limitedMessage, memoryRateStore, pgRateStore, recordFailure,
  type BucketName, type LimitResult, type RateStore, type Who,
} from './rate-limit'

type G = typeof globalThis & { __bvRate?: RateStore }
const g = globalThis as G

export function getRateStore(): RateStore {
  const pool = getPool()
  g.__bvRate ??= pool ? pgRateStore(pool) : memoryRateStore()
  return g.__bvRate
}

async function whoFor(did?: string | null): Promise<Who> {
  return { ip: clientIp(await headers()), did }
}

/**
 * For server actions and pages: counts one hit per bucket for this request's IP and, when given, DID.
 * Returns an error message to show, or null to go ahead. A limiter failure is logged and lets the request through,
 * so a database blip cannot lock everyone out.
 */
export async function limited(buckets: readonly BucketName[], did?: string | null): Promise<string | null> {
  try {
    const r = await checkLimits(getRateStore(), buckets, await whoFor(did))
    return r.ok ? null : limitedMessage(r.retryAfterSec)
  } catch (err) {
    console.error('rate limit check failed', err instanceof Error ? err.name : 'unknown')
    return null
  }
}

/** Same check for route handlers, returning the raw result so the handler can answer 429 with `Retry-After`. */
export async function limitedResult(buckets: readonly BucketName[], did?: string | null): Promise<LimitResult> {
  try {
    return await checkLimits(getRateStore(), buckets, await whoFor(did))
  } catch (err) {
    console.error('rate limit check failed', err instanceof Error ? err.name : 'unknown')
    return { ok: true }
  }
}

/** Message while a failure bucket is full, else null. Does not count. */
export async function lockedOut(bucket: BucketName, did?: string | null): Promise<string | null> {
  try {
    const r = await isLockedOut(getRateStore(), bucket, await whoFor(did))
    return r.ok ? null : limitedMessage(r.retryAfterSec)
  } catch (err) {
    console.error('lockout check failed', err instanceof Error ? err.name : 'unknown')
    return null
  }
}

export async function failed(bucket: BucketName, did?: string | null): Promise<void> {
  try {
    await recordFailure(getRateStore(), bucket, await whoFor(did))
  } catch (err) {
    console.error('failure count failed', err instanceof Error ? err.name : 'unknown')
  }
}
