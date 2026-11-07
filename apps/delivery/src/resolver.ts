import { IdResolver } from '@atproto/identity'
import {
  BLUESKY_PROFILE_ADAPTER, activeAdapters, getPath, ratingFromLabels, readBlobRef, selfLabelValues,
  type Candidate, type ProfileAdapter, type Rating,
} from '@blueyvatar/core'
import { bytesMatchCid } from './cid.js'
import { BlobError, ByteLru, NegativeCache, normalizePdsEndpoint, parseMb } from './blob.js'
import type { IndexStore } from './store.js'

/** Self-label that asks apps to hide an account from logged-out viewers (spec section 9). */
const NO_UNAUTHENTICATED_LABEL = '!no-unauthenticated'

export interface Identity {
  did: string
  handle: string | null
  pds: string
}

/** One gallery image that passed the account label and blocklist checks. The caller filters by rating. */
export interface GalleryItem {
  cid: string
  rating: Rating
  caption: string | null
}

export interface AvatarResolver {
  resolveIdentity(identifier: { kind: 'did' | 'handle'; value: string }): Promise<Identity | null>
  /** Candidates in resolution order (spec section 7). */
  candidates(identity: Identity): Promise<Candidate[]>
  /** Gallery images in display order, empty when the account label hides the account. Blocked images are left out. */
  galleryItems(identity: Identity): Promise<GalleryItem[]>
  /** Raw record from the user's PDS, or null. */
  getRecord(identity: Identity, collection: string, rkey: string): Promise<Record<string, unknown> | null>
  /** Original blob bytes from the PDS via com.atproto.sync.getBlob. */
  getBlob(identity: Identity, cid: string): Promise<Uint8Array>
}

/** Fixed log message for an avatar over its adapter's size limit. */
export const AVATAR_TOO_LARGE_LOG = 'adapter avatar over size limit'
/**
 * The delivery process has no channel from the indexer, so a new Tangled record can take up
 * to this long to show after a miss was cached.
 */
export const NO_RECORD_TTL_MS = 10 * 60_000
export const NO_RECORD_MAX = 10_000

export interface AtprotoResolverOptions {
  index: IndexStore
  adapters: readonly ProfileAdapter[]
  fetch?: typeof globalThis.fetch
  log?: (msg: string, meta?: Record<string, unknown>) => void
  timeoutMs?: number
  /** Retries after the first attempt, for 5xx, network errors, and timeouts. Default 2. */
  maxRetries?: number
  /** Backoff before retry n (1-based). Default 100 ms then 300 ms. */
  backoffMs?: (attempt: number) => number
  sleep?: (ms: number) => Promise<void>
  negativeTtlMs?: number
  negativeMax?: number
  /** How long "no record" is remembered per DID and collection. Default 10 minutes. */
  noRecordTtlMs?: number
  /** Size cap for the no-record cache. Default 10,000 entries. */
  noRecordMax?: number
  /** Size cap for the original-bytes cache in MB. Default from BLOB_CACHE_MB, else 32. */
  blobCacheMb?: number
}

/** Resolves identities with @atproto/identity and reads records from the user's PDS. */
export class AtprotoResolver implements AvatarResolver {
  private id = new IdResolver({})
  private fetch: typeof globalThis.fetch
  private log: NonNullable<AtprotoResolverOptions['log']>
  private timeoutMs: number
  private maxRetries: number
  private backoffMs: (attempt: number) => number
  private sleep: (ms: number) => Promise<void>
  private failing: NegativeCache
  private noRecord: NegativeCache
  private originals: ByteLru

  constructor(private opts: AtprotoResolverOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch
    this.log = opts.log ?? (() => {})
    this.timeoutMs = opts.timeoutMs ?? 5000
    this.maxRetries = opts.maxRetries ?? 2
    this.backoffMs = opts.backoffMs ?? ((n) => (n === 1 ? 100 : 300))
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.failing = new NegativeCache(opts.negativeTtlMs ?? 30_000, opts.negativeMax ?? 256)
    this.noRecord = new NegativeCache(opts.noRecordTtlMs ?? NO_RECORD_TTL_MS, opts.noRecordMax ?? NO_RECORD_MAX)
    this.originals = new ByteLru(Math.floor((opts.blobCacheMb ?? parseMb(process.env.BLOB_CACHE_MB, 32)) * 1024 * 1024))
  }

  async resolveIdentity(identifier: { kind: 'did' | 'handle'; value: string }): Promise<Identity | null> {
    let did = identifier.value
    if (identifier.kind === 'handle') {
      const resolved = await this.id.handle.resolve(identifier.value)
      if (!resolved) return null
      did = resolved
    }
    try {
      const data = await this.id.did.resolveAtprotoData(did)
      // A handle is only trusted when the DID document names it back.
      const handle = identifier.kind === 'handle' && data.handle !== identifier.value ? null : data.handle
      return { did: data.did, handle, pds: data.pds }
    } catch (err) {
      this.log('identity resolution failed', { did, err: String(err) })
      return null
    }
  }

  async getRecord(identity: Identity, collection: string, rkey: string) {
    const url = new URL('/xrpc/com.atproto.repo.getRecord', identity.pds)
    url.searchParams.set('repo', identity.did)
    url.searchParams.set('collection', collection)
    url.searchParams.set('rkey', rkey)
    const res = await this.fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) })
    if (res.status === 400 || res.status === 404) return null
    if (!res.ok) throw new Error(`getRecord ${collection} returned ${res.status}`)
    const body = (await res.json()) as { value?: Record<string, unknown> }
    return body.value ?? null
  }

  async getBlob(identity: Identity, cid: string) {
    const cacheKey = `${identity.did}/${cid}`
    const cached = this.originals.get(cacheKey)
    if (cached) {
      this.logBlob(identity, cid, 'cache_hit')
      return cached
    }
    const base = normalizePdsEndpoint(identity.pds)
    if (!base) {
      this.logBlob(identity, cid, 'invalid_endpoint')
      throw new BlobError('invalid_endpoint', 'PDS endpoint is not usable')
    }
    const host = base.host
    if (this.failing.has(host)) {
      this.logBlob(identity, cid, 'negative_cache', { host })
      throw new BlobError('upstream', 'PDS recently failed')
    }
    const url = new URL('/xrpc/com.atproto.sync.getBlob', base)
    url.searchParams.set('did', identity.did)
    url.searchParams.set('cid', cid)
    let lastStatus: number | undefined
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(this.backoffMs(attempt))
      let res: Response
      try {
        res = await this.fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) })
      } catch (err) {
        const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
        lastStatus = undefined
        this.logBlob(identity, cid, timeout ? 'timeout' : 'network_error', { host, attempt })
        continue
      }
      if (res.status === 404) {
        this.logBlob(identity, cid, 'not_found', { host, status: 404, attempt })
        throw new BlobError('not_found', 'Blob not found on PDS', 404)
      }
      if (res.status >= 500) {
        lastStatus = res.status
        this.logBlob(identity, cid, 'server_error', { host, status: res.status, attempt })
        continue
      }
      if (!res.ok) {
        this.logBlob(identity, cid, 'client_error', { host, status: res.status, attempt })
        throw new BlobError('upstream', `PDS returned ${res.status}`, res.status)
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (!bytesMatchCid(bytes, cid)) {
        this.logBlob(identity, cid, 'cid_mismatch', { host, attempt })
        throw new BlobError('upstream', 'blob bytes do not match CID')
      }
      this.failing.clear(host)
      this.originals.set(cacheKey, bytes)
      this.logBlob(identity, cid, 'ok', { host, status: res.status, attempt, bytes: bytes.byteLength })
      return bytes
    }
    this.failing.add(host)
    throw new BlobError('upstream', 'PDS unavailable', lastStatus)
  }

  /** Fixed log shape. Never includes headers, tokens, or URLs. */
  private logBlob(identity: Identity, cid: string, outcome: string, extra: { host?: string; status?: number; attempt?: number; bytes?: number } = {}) {
    this.log('getBlob', {
      outcome, did: identity.did, cid,
      host: extra.host ?? null, status: extra.status ?? null, attempt: extra.attempt ?? null, bytes: extra.bytes ?? null,
    })
  }

  async galleryItems(identity: Identity): Promise<GalleryItem[]> {
    // Same account-level label rule as avatars. Gallery images are never avatar candidates.
    if ((await this.readAccountLabels(identity)).hidden) return []
    const out: GalleryItem[] = []
    for (const img of await this.opts.index.galleryImages(identity.did)) {
      if (await this.opts.index.isBlocked(identity.did, img.cid)) continue
      out.push({ cid: img.cid, rating: img.rating, caption: img.caption ?? null })
    }
    return out
  }

  /**
   * Adapter record read with a short negative cache for "no record", keyed by DID and
   * collection. Errors are never cached. The Bluesky profile does not use this path because
   * its labels hide the whole account and must always be fresh.
   */
  private async readAdapterRecord(identity: Identity, collection: string, rkey: string) {
    const key = `${identity.did}\u0000${collection}`
    if (this.noRecord.has(key)) return null
    const record = await this.getRecord(identity, collection, rkey)
    if (!record) this.noRecord.add(key)
    return record
  }

  /** The label covers the whole account. A failed read hides everything: serving could reveal a labeled account. */
  private async readAccountLabels(identity: Identity): Promise<{ hidden: boolean; record: Record<string, unknown> | null }> {
    const bsky = BLUESKY_PROFILE_ADAPTER
    try {
      const record = await this.getRecord(identity, bsky.collection, bsky.rkey)
      return { hidden: selfLabelValues(getPath(record, bsky.labelsPath)).includes(NO_UNAUTHENTICATED_LABEL), record }
    } catch (err) {
      this.log('profile label read failed', { did: identity.did, err: String(err) })
      return { hidden: true, record: null }
    }
  }

  async candidates(identity: Identity): Promise<Candidate[]> {
    // The label covers the whole account, so it is read before any source is consulted.
    const bsky = BLUESKY_PROFILE_ADAPTER
    const labels = await this.readAccountLabels(identity)
    if (labels.hidden) return []
    const bskyRecord = labels.record

    const out: Candidate[] = []
    const images = await this.opts.index.serviceImages(identity.did)
    const sorted = [...images].sort((a, b) =>
      a.isDefault === b.isDefault ? b.createdAt.localeCompare(a.createdAt) : a.isDefault ? -1 : 1)
    for (const img of sorted) {
      if (await this.opts.index.isBlocked(identity.did, img.cid)) continue
      out.push({
        source: img.isDefault ? 'blueyvatar-default' : 'blueyvatar',
        did: identity.did,
        blob: { cid: img.cid, mimeType: img.mimeType },
        rating: img.rating,
        updatedAt: img.createdAt,
      })
    }
    const active = activeAdapters(this.opts.adapters)
    // Start every record read at once, then decide in priority order. A fallback adapter's
    // read is speculative: its result is used only when the adapter it backs up has no record.
    const reads = active.map((adapter) =>
      adapter.collection === bsky.collection && adapter.rkey === bsky.rkey
        ? Promise.resolve(bskyRecord)
        : this.readAdapterRecord(identity, adapter.collection, adapter.rkey))
    const settled = await Promise.allSettled(reads)
    const absent = new Set<string>()
    for (const [i, adapter] of active.entries()) {
      // A fallback adapter is used only when the adapter it backs up has no record.
      const primary = adapter.fallbackFor
      if (primary && active.some((a) => a.id === primary) && !absent.has(primary)) continue
      const result = settled[i]
      if (!result) continue
      if (result.status === 'rejected') {
        // An adapter that errors is skipped and logged, never fails the request.
        this.log('adapter failed', { adapter: adapter.id, did: identity.did, err: String(result.reason) })
        continue
      }
      try {
        const record = result.value
        if (!record) {
          absent.add(adapter.id)
          continue
        }
        const blob = readBlobRef(getPath(record, adapter.avatarPath))
        if (!blob || !adapter.accept.includes(blob.mimeType)) continue
        if (adapter.maxAvatarBytes !== undefined && blob.size !== undefined && blob.size > adapter.maxAvatarBytes) {
          this.log(AVATAR_TOO_LARGE_LOG, { adapter: adapter.id, did: identity.did, size: blob.size, max: adapter.maxAvatarBytes })
          continue
        }
        if (await this.opts.index.isBlocked(identity.did, blob.cid)) continue
        // On app.bsky.actor.profile these labels cover the whole account (spec section 9).
        const rating = ratingFromLabels(selfLabelValues(getPath(record, adapter.labelsPath)))
        out.push({ source: `adapter:${adapter.id}`, did: identity.did, blob, rating })
      } catch (err) {
        this.log('adapter failed', { adapter: adapter.id, did: identity.did, err: String(err) })
      }
    }
    return out
  }
}
