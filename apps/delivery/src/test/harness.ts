import { emailHash, imagePath, imageSig, type Candidate, type ImageFormat } from '@blueyvatar/core'
import { DEFAULT_SETTINGS } from '@blueyvatar/core/settings'
import { createApp, type AppDeps } from '../app.js'
import { MemoryLicenseStore, MemoryRateLimiter } from '../licenses.js'
import type { AvatarResolver, Identity } from '../resolver.js'
import { MemoryIndexStore } from '../store.js'
import { MemoryAlertLedger, UsageAlerts, type UsageAlert } from '../alerts.js'
import { MemoryUsageMeter } from '../usage.js'

export const DID = 'did:plc:abc123'
export const CID = 'bafyreiabc123'
export const SECRET = 'test-signing-secret'
export const DAY = 86_400_000
/** Signed /img path as the redirect routes build it. */
export const img = (size: number, format: ImageFormat = 'png', quality?: number, scope = '') => imagePath(SECRET, DID, CID, size, format, quality, scope)
/** Signed /img path for an arbitrary (possibly non-canonical) file name. */
export const raw = (file: string) => `/img/did%3Aplc%3Aabc123/${CID}/${imageSig(SECRET, DID, CID, file)}/${file}`
export const ident: Identity = { did: DID, handle: 'alice.test', pds: 'https://pds.test' }

type LicenseEntry = NonNullable<ConstructorParameters<typeof MemoryLicenseStore>[0]>[number]

/** One key on one license, as the store seeds them. The license id doubles as the key's license. */
export function lic(
  key: string,
  kind: 'publishable' | 'secret',
  licenseId: string,
  tier: LicenseEntry['license']['tier'] = 'plus',
  o: { domains?: string[]; expiresAt?: Date; status?: LicenseEntry['license']['status'] } = {},
): LicenseEntry {
  return {
    key: { key, kind, licenseId, domains: o.domains ?? [], ...(o.expiresAt ? { expiresAt: o.expiresAt } : {}) },
    license: { licenseId, owner: DID, tier, status: o.status ?? 'active' },
  }
}

/** Deps for an app with nothing in it: no identities, no keys, silent logger. Override what a test needs. */
export function baseDeps(over: Partial<AppDeps> = {}): AppDeps {
  return {
    settings: { current: () => DEFAULT_SETTINGS },
    index: new MemoryIndexStore(),
    resolver: {
      resolveIdentity: async () => null, candidates: async () => [], galleryItems: async () => [],
      getRecord: async () => null, getBlob: async () => new Uint8Array(),
    },
    licenses: new MemoryLicenseStore([]),
    limiter: new MemoryRateLimiter(),
    usage: new MemoryUsageMeter(),
    resize: async () => new Uint8Array(),
    defaultUrlAllowlist: [],
    trustCloudflare: false,
    imgSigningSecret: 's',
    ...over,
  }
}

export function setup(candidates: Candidate[] = [{ source: 'adapter:bluesky', did: DID, blob: { cid: 'bafyreiabc123', mimeType: 'image/jpeg' }, rating: 'g' }]) {
  const index = new MemoryIndexStore()
  index.emails.set(emailHash('alice@example.com'), DID)
  const resolver: AvatarResolver = {
    resolveIdentity: async (id) => (id.value === DID || id.value === 'alice.test' ? ident : null),
    candidates: async () => candidates,
    galleryItems: async () => [],
    getRecord: async (_i, collection) => (collection === 'app.bsky.actor.profile' ? { displayName: 'Alice', links: [{ uri: `at://${DID}/app.bsky.actor.link/l1`, cid: 'cl1' }, { uri: `at://${DID}/app.bsky.actor.link/l2`, cid: 'cl2' }, { uri: `at://${DID}/app.bsky.actor.link/l3`, cid: 'stale' }] } : null),
    getBlob: async () => new Uint8Array([1, 2, 3]),
    repoApps: async () => [{ id: 'tangled', name: 'Tangled', url: 'https://tangled.org' }],
  }
  const usage = new MemoryUsageMeter()
  const deps: AppDeps = {
    settings: { current: () => DEFAULT_SETTINGS },
    index, resolver, usage,
    licenses: new MemoryLicenseStore([
      lic('pk_test', 'publishable', 'L1', 'plus', { domains: ['*.example.com'] }),
      lic('sk_test', 'secret', 'L1'),
      lic('pk_old', 'publishable', 'L1', 'plus', { expiresAt: new Date(Date.now() - 1000) }),
      lic('sk_old', 'secret', 'L1', 'plus', { expiresAt: new Date(Date.now() - 1000) }),
      lic('pk_future', 'publishable', 'L1', 'plus', { expiresAt: new Date(Date.now() + 86_400_000) }),
      lic('sk_biz', 'secret', 'L3', 'business'),
      lic('sk_legacy', 'secret', 'L4', 'pro' as never),
      lic('sk_dead', 'secret', 'L2', 'plus', { status: 'suspended' }),
    ]),
    limiter: new MemoryRateLimiter(),
    resize: async () => new Uint8Array([9, 9]),
    profileBaseUrl: 'https://bv.test/',
    defaultUrlAllowlist: ['example.com'],
    trustCloudflare: true,
    imgSigningSecret: SECRET,
  }
  index.linkRecords.set(DID, [
    { rkey: 'l1', cid: 'cl1', url: 'https://alice.example/', title: 'Site' },
    { rkey: 'l2', cid: 'cl2', url: 'http://alice.example/', title: 'Insecure' },
    { rkey: 'l3', cid: 'cl3', url: 'https://old.example/', title: 'Edited' },
  ])
  const sent: UsageAlert[] = []
  deps.alerts = new UsageAlerts({ send: async (x) => { sent.push(x) } }, new MemoryAlertLedger())
  return { app: createApp(deps), index, usage, sent, deps }
}

export function setupDeps() { const { deps } = setup(); return { deps } }