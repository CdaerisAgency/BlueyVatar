/** Meters from spec section 12. */
export type Meter = 'origin_resolution' | 'transform' | 'profile_json'

/** Costs of serving /img, which carries no key. They are tracked per DID as a service cost. */
export type ServiceMeter = 'transform' | 'bytes_delivered'

export interface UsageMeter {
  /** Adds to a license counter for the current UTC month and returns the new total. */
  add(licenseId: string, meter: Meter, n?: number): Promise<number>
  /** Adds to the service-side cost counter for a DID (not billed to any license). */
  addService(did: string, meter: ServiceMeter, n?: number): Promise<void>
  /** Adds one keyed profile JSON call to the DID's daily counter for UTC today (profile view statistics, issue #173). Aggregate only: no IP or user agent. */
  addProfileCall(did: string, n?: number): Promise<void>
}

/** First day of the UTC month containing `now`, as YYYY-MM-DD. */
export function periodStart(now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 7)}-01`
}

export class MemoryUsageMeter implements UsageMeter {
  counts = new Map<string, number>()
  service = new Map<string, number>()
  /** `${did}:${YYYY-MM-DD}` to keyed profile JSON calls. */
  profileCalls = new Map<string, number>()
  async add(licenseId: string, meter: Meter, n = 1) {
    const k = `${licenseId}:${meter}`
    const total = (this.counts.get(k) ?? 0) + n
    this.counts.set(k, total)
    return total
  }
  async addProfileCall(did: string, n = 1) {
    const k = `${did}:${new Date().toISOString().slice(0, 10)}`
    this.profileCalls.set(k, (this.profileCalls.get(k) ?? 0) + n)
  }
  async addService(did: string, meter: ServiceMeter, n = 1) {
    const k = `${did}:${meter}`
    this.service.set(k, (this.service.get(k) ?? 0) + n)
  }
}
