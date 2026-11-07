import { ladderPaths } from '@blueyvatar/core'
import { errors, log } from './obs.js'

/**
 * Purges cached `/img` URLs from Cloudflare (spec sections 9 and 14.1).
 *
 * Plan limits, from https://developers.cloudflare.com/cache/how-to/purge-cache/ (checked 2026-11-03):
 * the Free plan supports purge by single-file URL, hostname, tag, prefix, and everything, with at
 * most 100 operations per request. Single-file purge allows 800 URLs per second, while hostname,
 * tag, prefix, and purge-everything share 5 requests per minute. Endpoint and body:
 * https://developers.cloudflare.com/api/resources/cache/methods/purge/
 *
 * Default mode "files" purges every public-scope URL that can exist per CID: the size ladder, all
 * formats, and each allowed quality for JPEG and WebP (75 URLs), signed with IMG_SIGNING_SECRET.
 * `/img` serves only those canonical paths and redirects anything else (off-ladder size, other
 * quality, query string) to one of them, so the set is complete for public avatars. LIMITATION:
 * restricted avatars use per-caller scoped URLs that are not listed here. Mode "prefix" purges
 * `host/img/{did}/{cid}/` in one operation and covers every variant, at the cost of the 5 per
 * minute limit.
 */
export interface PurgeLogger { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void }
export type PurgeMode = 'files' | 'prefix'

export interface CloudflarePurgerOptions {
  zoneId: string
  apiToken: string
  /** Public origin of the delivery API, such as https://blueyvatar.com. */
  publicUrl: string
  /** Delivery's IMG_SIGNING_SECRET, needed to build the ladder URLs in "files" mode. */
  signingSecret?: string
  mode?: PurgeMode
  retries?: number
  retryDelayMs?: number
  fetch?: typeof fetch
  log?: PurgeLogger
}

const FILES_PER_REQUEST = 100

export class CloudflarePurger {
  constructor(private o: CloudflarePurgerOptions) {}

  /** Purges every cached variant of the given CIDs. Failures are retried, then logged. Never throws. */
  async purge(did: string, cids: string[]): Promise<void> {
    const base = this.o.publicUrl.replace(/\/$/, '')
    const items = this.o.mode === 'prefix'
      ? cids.map((cid) => `${base.replace(/^https?:\/\//, '')}/img/${encodeURIComponent(did)}/${cid}/`)
      : cids.flatMap((cid) => ladderPaths(this.o.signingSecret ?? '', did, cid).map((p) => base + p))
    const key = this.o.mode === 'prefix' ? 'prefixes' : 'files'
    for (let i = 0; i < items.length; i += FILES_PER_REQUEST) {
      await this.send({ [key]: items.slice(i, i + FILES_PER_REQUEST) }, did)
    }
  }

  private async send(body: Record<string, string[]>, did: string): Promise<void> {
    const { zoneId, apiToken, retries = 3, retryDelayMs = 1000, log = console } = this.o
    const doFetch = this.o.fetch ?? fetch
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await doFetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (res.ok) return
        throw new Error(`Cloudflare purge returned ${res.status}`)
      } catch (err) {
        if (attempt === retries) {
          log.error('cloudflare purge failed', { did, error: (err as Error).message })
          return
        }
        await new Promise((r) => setTimeout(r, retryDelayMs * attempt))
      }
    }
  }
}

/** Returns a purge hook, or a no-op logger when CF_ZONE_ID, CF_API_TOKEN, or PUBLIC_DELIVERY_URL is unset. */
export function purgerFromEnv(env = process.env): (did: string, cids: string[]) => Promise<void> {
  const { CF_ZONE_ID: zoneId, CF_API_TOKEN: apiToken, PUBLIC_DELIVERY_URL: publicUrl, IMG_SIGNING_SECRET: signingSecret } = env
  const mode: PurgeMode = env.CF_PURGE_MODE === 'prefix' ? 'prefix' : 'files'
  if (!zoneId || !apiToken || !publicUrl || (mode === 'files' && !signingSecret)) {
    log.warn('CF_ZONE_ID, CF_API_TOKEN, PUBLIC_DELIVERY_URL, or IMG_SIGNING_SECRET (files mode) is not set; Cloudflare purges are logged only')
    return async (did, cids) => log.info('purge (no-op)', { did, cids })
  }
  const purger = new CloudflarePurger({ zoneId, apiToken, publicUrl, signingSecret, mode })
  return (did, cids) => purger.purge(did, cids)
}
