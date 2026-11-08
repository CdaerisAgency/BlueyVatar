/** Pure helpers for showing who is signed in. No server imports, so they are easy to test. */

/** What to show for a person: their handle, or the DID when the handle could not be resolved. */
export function displayName(v: { did: string; handle: string | null }): string {
  return v.handle ?? v.did
}

/** One uppercase letter for the avatar fallback. Falls back to "?" when the name has no letter or digit. */
export function avatarInitial(v: { did: string; handle: string | null }): string {
  const m = (v.handle ?? '').match(/[\p{L}\p{N}]/u)
  return m ? m[0].toUpperCase() : '?'
}

/** A small in-memory cache so a handle lookup does not run on every page view. */
export function makeTtlCache<V>(ttlMs: number, max = 500, now: () => number = Date.now) {
  const m = new Map<string, { v: V; exp: number }>()
  return {
    get(k: string): V | undefined {
      const e = m.get(k)
      if (!e) return undefined
      if (e.exp <= now()) {
        m.delete(k)
        return undefined
      }
      return e.v
    },
    set(k: string, v: V): void {
      if (m.size >= max) m.delete(m.keys().next().value as string)
      m.set(k, { v, exp: now() + ttlMs })
    },
  }
}
