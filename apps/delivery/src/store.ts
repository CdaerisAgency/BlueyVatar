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

/** A claim the service has attested (spec section 8). Hidden ones stay in profile JSON and are skipped by hovercards. */
export interface VerifiedAccount {
  platform: string
  uri: string
  verifiedAt: string
  hidden: boolean
}

/** What the indexer maintains in Postgres. */
export interface IndexStore {
  /** Takes a SHA256 (64 hex) or MD5 (32 hex) email hash. Unlinked and opted-out hashes both return null. */
  didForEmailHash(hash: string): Promise<string | null>
  serviceImages(did: string): Promise<IndexedImage[]>
  visibility(did: string): Promise<Visibility>
  /** False when the repo is taken down, suspended, or deactivated. */
  isRepoActive(did: string): Promise<boolean>
  /** Images removed from delivery after a report, keyed by blob CID. */
  isBlocked(did: string, cid: string): Promise<boolean>
  /** Claims whose latest attestation is verified and still matches the claim's uri, oldest first. */
  verifiedAccounts(did: string): Promise<VerifiedAccount[]>
}

export class MemoryIndexStore implements IndexStore {
  emails = new Map<string, string>()
  /** MD5 to SHA256 for linked emails, as email_links.email_md5 does in Postgres. */
  md5s = new Map<string, string>()
  images = new Map<string, IndexedImage[]>()
  rules = new Map<string, Visibility>()
  inactive = new Set<string>()
  blocked = new Set<string>()
  accounts = new Map<string, VerifiedAccount[]>()
  async didForEmailHash(hash: string) {
    const did = this.emails.get(hash.length === 32 ? (this.md5s.get(hash) ?? '') : hash) ?? null
    if (did && (await this.visibility(did)).emailLookupOptOut) return null
    return did
  }
  async serviceImages(did: string) { return this.images.get(did) ?? [] }
  async visibility(did: string) { return this.rules.get(did) ?? PUBLIC_VISIBILITY }
  async isRepoActive(did: string) { return !this.inactive.has(did) }
  async isBlocked(did: string, cid: string) { return this.blocked.has(`${did}/${cid}`) }
  async verifiedAccounts(did: string) { return this.accounts.get(did) ?? [] }
}
