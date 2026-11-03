import type { Rating } from '@blueyvatar/core'

/** Visibility rules a user sets for viewers (spec section 10.2). */
export interface Visibility {
  keyedOnly: boolean
  domainAllowlist: string[]
  hiddenProfile: boolean
  /** Opt out of email-hash lookup (spec section 13, item 6). */
  emailLookupOptOut: boolean
}

export const PUBLIC_VISIBILITY: Visibility = {
  keyedOnly: false, domainAllowlist: [], hiddenProfile: false, emailLookupOptOut: false,
}

export interface IndexedImage {
  rkey: string
  cid: string
  mimeType: string
  rating: Rating
  isDefault: boolean
  createdAt: string
}

/** What the indexer maintains in Postgres. */
export interface IndexStore {
  didForEmailHash(hash: string): Promise<string | null>
  serviceImages(did: string): Promise<IndexedImage[]>
  visibility(did: string): Promise<Visibility>
  /** False when the repo is taken down, suspended, or deactivated. */
  isRepoActive(did: string): Promise<boolean>
  /** Images removed from delivery after a report, keyed by blob CID. */
  isBlocked(did: string, cid: string): Promise<boolean>
}

export class MemoryIndexStore implements IndexStore {
  emails = new Map<string, string>()
  images = new Map<string, IndexedImage[]>()
  rules = new Map<string, Visibility>()
  inactive = new Set<string>()
  blocked = new Set<string>()
  async didForEmailHash(hash: string) {
    const did = this.emails.get(hash) ?? null
    if (did && (await this.visibility(did)).emailLookupOptOut) return null
    return did
  }
  async serviceImages(did: string) { return this.images.get(did) ?? [] }
  async visibility(did: string) { return this.rules.get(did) ?? PUBLIC_VISIBILITY }
  async isRepoActive(did: string) { return !this.inactive.has(did) }
  async isBlocked(did: string, cid: string) { return this.blocked.has(`${did}/${cid}`) }
}
