import { parseSafeHttpsUrl } from '@blueyvatar/core'

/** Raised by getBlob. `kind` drives the HTTP mapping in app.ts. */
export class BlobError extends Error {
  constructor(
    public kind: 'not_found' | 'upstream' | 'invalid_endpoint',
    message: string,
    public status?: number,
  ) {
    super(message)
  }
}

/**
 * Normalizes a PDS endpoint from a DID document. A bare hostname gets https://.
 * Only public https origins pass (no credentials, port, IP literal, or local name).
 * Returns the origin URL, or null when the endpoint is unusable.
 */
export function normalizePdsEndpoint(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s || /\s/.test(s)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`
  const u = parseSafeHttpsUrl(withScheme)
  if (!u) return null
  return new URL(u.origin)
}

/** Remembers failing keys for a short time. Bounded: the oldest entry is dropped at the cap. */
export class NegativeCache {
  private m = new Map<string, number>()
  constructor(private ttlMs: number, private max: number, private now: () => number = Date.now) {}
  has(key: string): boolean {
    const exp = this.m.get(key)
    if (exp === undefined) return false
    if (exp <= this.now()) {
      this.m.delete(key)
      return false
    }
    return true
  }
  add(key: string): void {
    this.m.delete(key)
    if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value as string)
    this.m.set(key, this.now() + this.ttlMs)
  }
  clear(key: string): void {
    this.m.delete(key)
  }
}

/** Byte-size-capped LRU. Entries larger than the cap are not stored. A cap of 0 disables it. */
export class ByteLru {
  private m = new Map<string, Uint8Array>()
  private bytes = 0
  constructor(private maxBytes: number) {}
  get(key: string): Uint8Array | undefined {
    const v = this.m.get(key)
    if (!v) return undefined
    this.m.delete(key)
    this.m.set(key, v)
    return v
  }
  set(key: string, v: Uint8Array): void {
    if (v.byteLength > this.maxBytes) return
    const old = this.m.get(key)
    if (old) this.bytes -= old.byteLength
    this.m.delete(key)
    this.m.set(key, v)
    this.bytes += v.byteLength
    while (this.bytes > this.maxBytes) {
      const k = this.m.keys().next().value as string
      this.bytes -= this.m.get(k)!.byteLength
      this.m.delete(k)
    }
  }
  get size(): number {
    return this.bytes
  }
}

/** Parses a size in MB from env text. Falls back to the default on anything unusable. */
export function parseMb(raw: string | undefined, fallbackMb: number): number {
  if (raw === undefined || raw.trim() === '') return fallbackMb
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallbackMb
}
