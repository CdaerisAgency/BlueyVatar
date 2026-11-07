import type { RateLimiter, RateWindow } from './licenses.js'
import type { Meter, ServiceMeter, UsageMeter, UsageSnapshot } from './usage.js'
import { periodStart } from './usage.js'

/**
 * First-tier counters that absorb per-request Postgres writes (issue #198). Each process counts in memory and
 * flushes the accumulated increments to Postgres on a timer, so a hot license costs one write per key per
 * interval instead of one per request. The first hit on a key (and the first hit of a new rate window) still
 * writes through, which seeds the local view with the shared total.
 *
 * Accuracy: across machines each one sees the other's traffic only at its next flush, so a limit can be
 * overshot by about (machines x requests per interval). A crash or hard kill loses at most one interval of
 * increments; SIGTERM and SIGINT flush first (server.ts). Both are small next to the limits being metered.
 */

export interface BatchOptions {
  /** Flush period in ms. Default 1000. */
  flushMs?: number
  /** Report a failed flush. The increments stay queued and retry on the next flush. */
  onError?: (err: unknown) => void
  now?: () => number
}

const DEFAULT_FLUSH_MS = 1000
/** Entries kept at once. Past this, new keys write straight through instead of being tracked. */
const MAX_TRACKED = 50_000
/** An idle usage key (nothing pending) is dropped after this long. */
const IDLE_EVICT_MS = 5 * 60_000

abstract class Flusher {
  private timer?: ReturnType<typeof setInterval>
  private flushing?: Promise<void>
  protected now: () => number
  protected onError: (err: unknown) => void
  constructor(opts: BatchOptions) {
    this.now = opts.now ?? Date.now
    this.onError = opts.onError ?? (() => undefined)
    const ms = opts.flushMs ?? DEFAULT_FLUSH_MS
    if (ms > 0) {
      this.timer = setInterval(() => void this.flush(), ms)
      this.timer.unref?.()
    }
  }
  protected abstract doFlush(): Promise<void>
  /** Writes everything pending. Concurrent calls share one run. */
  flush(): Promise<void> {
    this.flushing ??= this.doFlush().finally(() => { this.flushing = undefined })
    return this.flushing
  }
  /** Stops the timer and flushes once more. */
  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    await this.flush()
  }
}

export class BatchedRateLimiter extends Flusher implements RateLimiter {
  private buckets = new Map<string, { base: number; pending: number; reset: number; limit: number; windowSeconds: number }>()
  constructor(private inner: RateLimiter, opts: BatchOptions = {}) { super(opts) }

  private nowSec() { return Math.floor(this.now() / 1000) }

  async hit(bucket: string, limit: number, windowSeconds: number, n = 1): Promise<RateWindow> {
    const s = this.buckets.get(bucket)
    if (s && s.reset > this.nowSec()) {
      s.pending += n
      s.limit = limit
      s.windowSeconds = windowSeconds
      return view(s.base + s.pending, limit, s.reset)
    }
    // New bucket or expired window: write through so the shared window starts here.
    const w = await this.inner.hit(bucket, limit, windowSeconds, n)
    if (this.buckets.size < MAX_TRACKED || s) {
      this.buckets.set(bucket, { base: countOf(w), pending: 0, reset: w.reset, limit, windowSeconds })
    }
    return w
  }

  protected async doFlush(): Promise<void> {
    const t = this.nowSec()
    const work: Promise<void>[] = []
    for (const [bucket, s] of this.buckets) {
      // Increments for a window that has ended are dropped: writing them would open a new window with stale counts.
      if (s.reset <= t) { this.buckets.delete(bucket); continue }
      if (s.pending === 0) continue
      const p = s.pending
      s.pending = 0
      work.push(
        this.inner.hit(bucket, s.limit, s.windowSeconds, p).then(
          (w) => { s.base = countOf(w); s.reset = w.reset },
          (err) => { s.pending += p; this.onError(err) },
        ),
      )
    }
    await Promise.all(work)
  }

  /** Buckets currently tracked in memory (for tests and metrics). */
  get size(): number { return this.buckets.size }
}

/** Window count recovered from a RateWindow. When exceeded the exact count is unknown, so limit + 1 stands in. */
function countOf(w: RateWindow): number {
  return w.exceeded ? w.limit + 1 : w.limit - w.remaining
}

function view(count: number, limit: number, reset: number): RateWindow {
  return { limit, remaining: Math.max(0, limit - count), reset, exceeded: count > limit }
}

export class BatchedUsageMeter extends Flusher implements UsageMeter {
  private licenses = new Map<string, { licenseId: string; meter: Meter; base: number; pending: number; touched: number }>()
  private service = new Map<string, { did: string; meter: ServiceMeter; pending: number }>()
  private profile = new Map<string, { did: string; pending: number }>()
  constructor(private inner: UsageMeter, opts: BatchOptions = {}) { super(opts) }

  async add(licenseId: string, meter: Meter, n = 1): Promise<number> {
    const key = `${periodStart(new Date(this.now()))}|${licenseId}|${meter}`
    const s = this.licenses.get(key)
    if (s) {
      s.pending += n
      s.touched = this.now()
      return s.base + s.pending
    }
    const total = await this.inner.add(licenseId, meter, n)
    const raced = this.licenses.get(key)
    if (raced) raced.base = Math.max(raced.base, total)
    else if (this.licenses.size < MAX_TRACKED) this.licenses.set(key, { licenseId, meter, base: total, pending: 0, touched: this.now() })
    return total
  }

  /** Reads bypass the batch: pending increments are flushed first so /usage reflects this process's own traffic. */
  async read(licenseId: string, periods: readonly string[], days: readonly string[]): Promise<UsageSnapshot> {
    await this.flush()
    return this.inner.read(licenseId, periods, days)
  }

  async addService(did: string, meter: ServiceMeter, n = 1): Promise<void> {
    const k = `${did}|${meter}`
    const s = this.service.get(k) ?? { did, meter, pending: 0 }
    s.pending += n
    this.service.set(k, s)
  }

  async addProfileCall(did: string, n = 1): Promise<void> {
    const s = this.profile.get(did) ?? { did, pending: 0 }
    s.pending += n
    this.profile.set(did, s)
  }

  protected async doFlush(): Promise<void> {
    const t = this.now()
    const work: Promise<unknown>[] = []
    for (const [key, s] of this.licenses) {
      if (s.pending === 0) {
        if (t - s.touched > IDLE_EVICT_MS) this.licenses.delete(key)
        continue
      }
      const p = s.pending
      s.pending = 0
      work.push(
        this.inner.add(s.licenseId, s.meter, p).then(
          (total) => { s.base = total },
          (err) => { s.pending += p; this.onError(err) },
        ),
      )
    }
    for (const [key, s] of this.service) {
      this.service.delete(key)
      work.push(this.inner.addService(s.did, s.meter, s.pending).catch((err) => { this.addService(s.did, s.meter, s.pending); this.onError(err) }))
    }
    for (const [key, s] of this.profile) {
      this.profile.delete(key)
      work.push(this.inner.addProfileCall(s.did, s.pending).catch((err) => { this.addProfileCall(s.did, s.pending); this.onError(err) }))
    }
    await Promise.all(work)
  }
}
