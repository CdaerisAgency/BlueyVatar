import { ladderPaths, WARM_SIZES } from '@blueyvatar/core'

/**
 * Requests the common sizes through the public URL so Cloudflare caches them (spec section 4).
 * Best-effort: errors are logged and never reach the caller. These requests hit `/img`, which
 * uses no license key, so they are a service cost and are not metered (spec section 12).
 * Whether warming pays off on the free plan is not measured here.
 */
export interface WarmOptions {
  publicUrl: string
  concurrency?: number
  timeoutMs?: number
  fetch?: typeof fetch
  log?: (msg: string, meta?: unknown) => void
}

export async function warmImage(did: string, cid: string, o: WarmOptions): Promise<void> {
  const base = o.publicUrl.replace(/\/$/, '')
  const queue = ladderPaths(did, cid, WARM_SIZES, ['png']).map((p) => base + p)
  const doFetch = o.fetch ?? fetch
  const log = o.log ?? console.warn
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        const res = await doFetch(url, { signal: AbortSignal.timeout(o.timeoutMs ?? 10_000) })
        await res.arrayBuffer()
        if (!res.ok) log('cache warm got a non-ok response', { url, status: res.status })
      } catch (err) {
        log('cache warm failed', { url, error: (err as Error).message })
      }
    }
  }
  await Promise.all(Array.from({ length: o.concurrency ?? 2 }, worker))
}

/** Warm hook, or undefined when PUBLIC_DELIVERY_URL is unset. */
export function warmerFromEnv(env = process.env): ((did: string, cid: string) => Promise<void>) | undefined {
  const publicUrl = env.PUBLIC_DELIVERY_URL
  if (!publicUrl) return undefined
  return (did, cid) => warmImage(did, cid, { publicUrl })
}
