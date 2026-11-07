import { DAILY_METERS } from '@blueyvatar/core'

/** Meters from spec section 12. */
export type Meter = 'origin_resolution' | 'transform' | 'profile_json'

/** Costs of serving /img, which carries no key. They are tracked per DID as a service cost. */
export type ServiceMeter = 'transform' | 'bytes_delivered'

/** What GET /usage reads. Keys are `<period or day>|<meter>`: `2026-11-01|origin_resolution`, `2026-11-07|profile_json`. */
export interface UsageSnapshot {
  monthly: Map<string, number>
  daily: Map<string, number>
}

export interface UsageMeter {
  /** Monthly counters for the given period starts and daily counters for the given days. Missing rows are absent. Reads never meter. */
  read(licenseId: string, periods: readonly string[], days: readonly string[]): Promise<UsageSnapshot>
  /** Adds to a license counter for the current UTC month and returns the new total. */
  add(licenseId: string, meter: Meter, n?: number): Promise<number>
  /** Adds to the service-side cost counter for a DID (not billed to any license). */
  addService(did: string, meter: ServiceMeter, n?: number): Promise<void>
}

/** First day of the UTC month containing `now`, as YYYY-MM-DD. */
export function periodStart(now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 7)}-01`
}

export class MemoryUsageMeter implements UsageMeter {
  counts = new Map<string, number>()
  service = new Map<string, number>()
  /** `<license>|<period>|<meter>` and `<license>|<day>|<meter>`, as the Postgres tables hold them. */
  byPeriod = new Map<string, number>()
  byDay = new Map<string, number>()
  constructor(private now: () => Date = () => new Date()) {}
  async add(licenseId: string, meter: Meter, n = 1) {
    const k = `${licenseId}:${meter}`
    const total = (this.counts.get(k) ?? 0) + n
    this.counts.set(k, total)
    const t = this.now()
    const pk = `${licenseId}|${periodStart(t)}|${meter}`
    this.byPeriod.set(pk, (this.byPeriod.get(pk) ?? 0) + n)
    if ((DAILY_METERS as readonly string[]).includes(meter)) {
      const dk = `${licenseId}|${t.toISOString().slice(0, 10)}|${meter}`
      this.byDay.set(dk, (this.byDay.get(dk) ?? 0) + n)
    }
    return total
  }
  async read(licenseId: string, periods: readonly string[], days: readonly string[]): Promise<UsageSnapshot> {
    const pick = (src: Map<string, number>, keys: readonly string[], meters: readonly string[]) => {
      const out = new Map<string, number>()
      for (const k of keys) for (const m of meters) {
        const v = src.get(`${licenseId}|${k}|${m}`)
        if (v !== undefined) out.set(`${k}|${m}`, v)
      }
      return out
    }
    return { monthly: pick(this.byPeriod, periods, ['origin_resolution', 'transform', 'profile_json']), daily: pick(this.byDay, days, DAILY_METERS) }
  }
  async addService(did: string, meter: ServiceMeter, n = 1) {
    const k = `${did}:${meter}`
    this.service.set(k, (this.service.get(k) ?? 0) + n)
  }
}
