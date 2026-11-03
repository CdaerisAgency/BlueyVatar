import type { Tier } from '@blueyvatar/core'

/** Service-side license record (spec section 10.3). */
export interface License {
  licenseId: string
  owner: string
  tier: Tier
  status: 'active' | 'past_due' | 'suspended' | 'canceled'
}

export interface ApiKey {
  key: string
  kind: 'secret' | 'publishable'
  licenseId: string
  /** Exact hosts, `*.example.com` wildcards, or `localhost`. Publishable keys only. */
  domains: string[]
}

export interface LicenseStore {
  findKey(key: string): Promise<{ key: ApiKey; license: License } | null>
}

export interface RateWindow {
  limit: number
  remaining: number
  /** Unix seconds when the window resets. */
  reset: number
  /** True once this request went past the limit. */
  exceeded: boolean
}

export interface RateLimiter {
  hit(bucket: string, limit: number, windowSeconds: number): Promise<RateWindow>
}

export function hostAllowed(host: string, domains: readonly string[]): boolean {
  const h = host.toLowerCase()
  return domains.some((d) => {
    const dl = d.toLowerCase()
    if (dl.startsWith('*.')) return h.endsWith(dl.slice(1)) && h.length > dl.length - 1
    return h === dl
  })
}

/** Fixed-window limiter for development and tests. Production uses Postgres. */
export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { count: number; reset: number }>()
  constructor(private now: () => number = () => Math.floor(Date.now() / 1000)) {}
  async hit(bucket: string, limit: number, windowSeconds: number): Promise<RateWindow> {
    const t = this.now()
    let b = this.buckets.get(bucket)
    if (!b || b.reset <= t) {
      b = { count: 0, reset: t + windowSeconds }
      this.buckets.set(bucket, b)
    }
    b.count += 1
    return { limit, remaining: Math.max(0, limit - b.count), reset: b.reset, exceeded: b.count > limit }
  }
}

export class MemoryLicenseStore implements LicenseStore {
  constructor(private keys: Array<{ key: ApiKey; license: License }> = []) {}
  async findKey(key: string) {
    return this.keys.find((k) => k.key.key === key) ?? null
  }
}
