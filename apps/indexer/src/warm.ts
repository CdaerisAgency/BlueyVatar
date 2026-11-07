import { IMAGE_FORMATS, IMAGE_SIZE_LADDER, WARM_FORMATS, WARM_HEADER, WARM_SIZES, imagePath, type ImageFormat } from '@blueyvatar/core'
import { log as logger } from './obs.js'

/**
 * Requests the common sizes and formats through the public hostname so Cloudflare caches them
 * (spec section 4). Requests use the signed `/img` path and, when WARM_SECRET is set, carry
 * `x-warm-auth` so delivery skips its usage meters (spec section 12). `/img` takes no license key,
 * so warming never touches a license meter or the per-key and per-IP rate limits.
 *
 * Best-effort: errors are logged and never reach the caller. A shared limiter caps concurrency and
 * requests per minute across all warm jobs; work over the cap is dropped, because the next
 * visitor warms the entry anyway. Each job logs its `cf-cache-status` counts so the value of
 * warming can be measured (docs/deploy.md).
 *
 * Env: PUBLIC_DELIVERY_URL (unset disables warming), IMG_SIGNING_SECRET, WARM_SECRET,
 * WARM_SIZES (comma list of ladder sizes), WARM_FORMATS (png, jpeg, webp),
 * WARM_CONCURRENCY (default 2), WARM_MAX_PER_MINUTE (default 120).
 */
export interface WarmConfig {
  sizes: readonly number[]
  formats: readonly ImageFormat[]
  concurrency: number
  maxPerMinute: number
}

export const DEFAULT_WARM_CONFIG: WarmConfig = { sizes: WARM_SIZES, formats: WARM_FORMATS, concurrency: 2, maxPerMinute: 120 }

const list = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean)
const posInt = (v: string | undefined, d: number) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d)

/** Reads the warm config from env. Invalid entries are dropped; an empty result falls back to the default. */
export function warmConfigFromEnv(env: Record<string, string | undefined> = process.env): WarmConfig {
  const sizes = list(env.WARM_SIZES).map(Number).filter((n) => (IMAGE_SIZE_LADDER as readonly number[]).includes(n))
  const formats = list(env.WARM_FORMATS).filter((f): f is ImageFormat => (IMAGE_FORMATS as readonly string[]).includes(f))
  return {
    sizes: sizes.length ? sizes : DEFAULT_WARM_CONFIG.sizes,
    formats: formats.length ? formats : DEFAULT_WARM_CONFIG.formats,
    concurrency: posInt(env.WARM_CONCURRENCY, DEFAULT_WARM_CONFIG.concurrency),
    maxPerMinute: posInt(env.WARM_MAX_PER_MINUTE, DEFAULT_WARM_CONFIG.maxPerMinute),
  }
}

export interface WarmerOptions {
  publicUrl: string
  /** Delivery's IMG_SIGNING_SECRET; /img serves only signed paths. */
  signingSecret: string
  /** Delivery's WARM_SECRET, sent as x-warm-auth. */
  warmSecret?: string
  config?: WarmConfig
  timeoutMs?: number
  fetch?: typeof fetch
  now?: () => number
  log?: (msg: string, meta?: unknown) => void
}

export class CacheWarmer {
  private active = 0
  private waiters: Array<() => void> = []
  private stamps: number[] = []
  private cfg: WarmConfig
  constructor(private o: WarmerOptions) { this.cfg = o.config ?? DEFAULT_WARM_CONFIG }

  /** Warms every configured size and format for one blob. Never throws. */
  async warm(did: string, cid: string): Promise<void> {
    try {
      const base = this.o.publicUrl.replace(/\/$/, '')
      const urls = this.cfg.formats.flatMap((f) => this.cfg.sizes.map((s) => base + imagePath(this.o.signingSecret, did, cid, s, f)))
      const log = this.o.log ?? ((m: string, meta?: unknown) => logger.warn(m, meta as Record<string, unknown> | undefined))
      const counts: Record<string, number> = {}
      let dropped = 0
      await Promise.all(urls.map(async (url) => {
        if (!this.takeSlot()) { dropped++; return }
        await this.acquire()
        try {
          const headers: Record<string, string> = this.o.warmSecret ? { [WARM_HEADER]: this.o.warmSecret } : {}
          const res = await (this.o.fetch ?? fetch)(url, { headers, signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000) })
          await res.arrayBuffer()
          const status = (res.headers?.get('cf-cache-status') ?? 'none').toLowerCase()
          counts[status] = (counts[status] ?? 0) + 1
          if (!res.ok) log('cache warm got a non-ok response', { url, status: res.status })
        } catch (err) {
          counts.error = (counts.error ?? 0) + 1
          log('cache warm failed', { url, error: (err as Error).message })
        } finally {
          this.release()
        }
      }))
      logger.info('cache warm', { did, cid, requested: urls.length - dropped, dropped, cacheStatus: counts })
    } catch (err) {
      ;(this.o.log ?? ((m: string, meta?: unknown) => logger.warn(m, meta as Record<string, unknown> | undefined)))('cache warm failed', { did, cid, error: (err as Error).message })
    }
  }

  /** Sliding one-minute window. Returns false when the per-minute cap is spent. */
  private takeSlot(): boolean {
    const now = (this.o.now ?? Date.now)()
    this.stamps = this.stamps.filter((t) => now - t < 60_000)
    if (this.stamps.length >= this.cfg.maxPerMinute) return false
    this.stamps.push(now)
    return true
  }

  private async acquire(): Promise<void> {
    if (this.active < this.cfg.concurrency) { this.active++; return }
    await new Promise<void>((r) => this.waiters.push(r))
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) next()
    else this.active--
  }
}

/** Warm hook, or undefined when PUBLIC_DELIVERY_URL or IMG_SIGNING_SECRET is unset. */
export function warmerFromEnv(env: Record<string, string | undefined> = process.env): ((did: string, cid: string) => Promise<void>) | undefined {
  const { PUBLIC_DELIVERY_URL: publicUrl, IMG_SIGNING_SECRET: signingSecret, WARM_SECRET: warmSecret } = env
  if (!publicUrl || !signingSecret) return undefined
  const w = new CacheWarmer({ publicUrl, signingSecret, warmSecret: warmSecret || undefined, config: warmConfigFromEnv(env) })
  return (did, cid) => w.warm(did, cid)
}
