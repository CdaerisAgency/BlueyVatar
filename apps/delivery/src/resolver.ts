import { IdResolver } from '@atproto/identity'
import {
  BLUESKY_PROFILE_ADAPTER, activeAdapters, getPath, ratingFromLabels, readBlobRef, selfLabelValues,
  type Candidate, type ProfileAdapter, type Rating,
} from '@blueyvatar/core'
import { bytesMatchCid } from './cid.js'
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

export interface AtprotoResolverOptions {
  index: IndexStore
  adapters: readonly ProfileAdapter[]
  fetch?: typeof globalThis.fetch
  log?: (msg: string, meta?: Record<string, unknown>) => void
  timeoutMs?: number
}

/** Resolves identities with @atproto/identity and reads records from the user's PDS. */
export class AtprotoResolver implements AvatarResolver {
  private id = new IdResolver({})
  private fetch: typeof globalThis.fetch
  private log: NonNullable<AtprotoResolverOptions['log']>
  private timeoutMs: number

  constructor(private opts: AtprotoResolverOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch
    this.log = opts.log ?? (() => {})
    this.timeoutMs = opts.timeoutMs ?? 5000
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
    const url = new URL('/xrpc/com.atproto.sync.getBlob', identity.pds)
    url.searchParams.set('did', identity.did)
    url.searchParams.set('cid', cid)
    const res = await this.fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) })
    if (!res.ok) throw new Error(`getBlob returned ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (!bytesMatchCid(bytes, cid)) throw new Error('blob bytes do not match CID')
    return bytes
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
    for (const adapter of activeAdapters(this.opts.adapters)) {
      try {
        const record = adapter.collection === bsky.collection && adapter.rkey === bsky.rkey
          ? bskyRecord
          : await this.getRecord(identity, adapter.collection, adapter.rkey)
        if (!record) continue
        const blob = readBlobRef(getPath(record, adapter.avatarPath))
        if (!blob || !adapter.accept.includes(blob.mimeType)) continue
        if (await this.opts.index.isBlocked(identity.did, blob.cid)) continue
        // On app.bsky.actor.profile these labels cover the whole account (spec section 9).
        const rating = ratingFromLabels(selfLabelValues(getPath(record, adapter.labelsPath)))
        out.push({ source: `adapter:${adapter.id}`, did: identity.did, blob, rating })
      } catch (err) {
        // An adapter that errors is skipped and logged, never fails the request.
        this.log('adapter failed', { adapter: adapter.id, did: identity.did, err: String(err) })
      }
    }
    return out
  }
}
