/** Meters from spec section 12. */
export type Meter = 'origin_resolution' | 'transform' | 'profile_json'

export interface UsageMeter {
  add(licenseId: string, meter: Meter, n?: number): Promise<void>
}

export class MemoryUsageMeter implements UsageMeter {
  counts = new Map<string, number>()
  async add(licenseId: string, meter: Meter, n = 1) {
    const k = `${licenseId}:${meter}`
    this.counts.set(k, (this.counts.get(k) ?? 0) + n)
  }
}
