/** Small in-memory TTL cache for host to handle lookups, including misses. */
export type Clock = () => number

export class TtlCache<V> {
  private map = new Map<string, { value: V; expires: number }>()
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 1000,
    private readonly now: Clock = Date.now,
  ) {}

  get(key: string): { value: V } | undefined {
    const e = this.map.get(key)
    if (!e) return undefined
    if (e.expires <= this.now()) {
      this.map.delete(key)
      return undefined
    }
    return { value: e.value }
  }

  set(key: string, value: V, ttlMs = this.ttlMs): void {
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
    this.map.set(key, { value, expires: this.now() + ttlMs })
  }

  delete(key: string): void {
    this.map.delete(key)
  }
}
