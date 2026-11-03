import { describe, expect, it } from 'vitest'
import { emailHash, type Candidate } from '@blueyvatar/core'
import { createApp, type AppDeps } from './app.js'
import { MemoryLicenseStore, MemoryRateLimiter } from './licenses.js'
import type { AvatarResolver, Identity } from './resolver.js'
import { MemoryIndexStore, PUBLIC_VISIBILITY } from './store.js'
import { MemoryUsageMeter } from './usage.js'

const DID = 'did:plc:abc123'
const ident: Identity = { did: DID, handle: 'alice.test', pds: 'https://pds.test' }

function setup(candidates: Candidate[] = [{ source: 'adapter:bluesky', did: DID, blob: { cid: 'bafyreiabc123', mimeType: 'image/jpeg' }, rating: 'g' }]) {
  const index = new MemoryIndexStore()
  index.emails.set(emailHash('alice@example.com'), DID)
  const resolver: AvatarResolver = {
    resolveIdentity: async (id) => (id.value === DID || id.value === 'alice.test' ? ident : null),
    candidates: async () => candidates,
    getRecord: async (_i, collection) => (collection === 'app.bsky.actor.profile' ? { displayName: 'Alice' } : null),
    getBlob: async () => new Uint8Array([1, 2, 3]),
  }
  const usage = new MemoryUsageMeter()
  const deps: AppDeps = {
    index, resolver, usage,
    licenses: new MemoryLicenseStore([
      { key: { key: 'pk_test', kind: 'publishable', licenseId: 'L1', domains: ['*.example.com'] }, license: { licenseId: 'L1', owner: DID, tier: 'pro', status: 'active' } },
      { key: { key: 'sk_test', kind: 'secret', licenseId: 'L1', domains: [] }, license: { licenseId: 'L1', owner: DID, tier: 'pro', status: 'active' } },
      { key: { key: 'sk_dead', kind: 'secret', licenseId: 'L2', domains: [] }, license: { licenseId: 'L2', owner: DID, tier: 'pro', status: 'suspended' } },
    ]),
    limiter: new MemoryRateLimiter(),
    resize: async () => new Uint8Array([9, 9]),
    defaultUrlAllowlist: ['example.com'],
    trustCloudflare: true,
  }
  return { app: createApp(deps), index, usage }
}

describe('delivery API', () => {
  it('redirects an email hash to an immutable image path', async () => {
    const { app } = setup()
    const res = await app.request(`/avatar/${emailHash('Alice@Example.com')}?s=4000`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/img/did%3Aplc%3Aabc123/bafyreiabc123/512.png')
    expect(res.headers.get('x-adjusted-params')).toBe('s')
    expect(res.headers.get('x-rate-limit-limit')).toBe('100')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('rejects anything that is not a SHA256 hash', async () => {
    const { app } = setup()
    const res = await app.request('/avatar/alice@example.com')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_identifier')
  })

  it('serves the default when nothing passes the rating filter', async () => {
    const { app } = setup([{ source: 'blueyvatar', did: DID, blob: { cid: 'bafyx', mimeType: 'image/png' }, rating: 'x' }])
    const res = await app.request('/u/alice.test?d=404')
    expect(res.status).toBe(404)
    const res2 = await app.request('/u/alice.test?d=identicon')
    expect(res2.headers.get('location')).toMatch(/^\/default\/identicon\/80\.png/)
  })

  it('applies tier entitlements and meters keyed requests', async () => {
    const { app, usage } = setup()
    const res = await app.request('/u/did:plc:abc123?fmt=webp&q=70', { headers: { 'x-api-key': 'sk_test' } })
    expect(res.headers.get('location')).toBe('/img/did%3Aplc%3Aabc123/bafyreiabc123/80-q70.webp')
    expect(res.headers.get('x-tier')).toBe('pro')
    expect(usage.counts.get('L1:origin_resolution')).toBe(1)
  })

  it('checks publishable key domains and license status', async () => {
    const { app } = setup()
    expect((await app.request('/u/alice.test?token=pk_test', { headers: { origin: 'https://evil.test' } })).status).toBe(403)
    expect((await app.request('/u/alice.test?token=pk_test', { headers: { origin: 'https://app.example.com' } })).status).toBe(302)
    expect((await app.request('/u/alice.test?token=sk_test')).status).toBe(401)
    expect((await app.request('/u/alice.test', { headers: { 'x-api-key': 'sk_dead' } })).status).toBe(402)
  })

  it('enforces the anonymous daily limit per client IP', async () => {
    const { app } = setup()
    let last = 0
    for (let i = 0; i < 101; i++) last = (await app.request('/u/alice.test', { headers: { 'cf-connecting-ip': '203.0.113.9' } })).status
    expect(last).toBe(429)
    expect((await app.request('/u/alice.test', { headers: { 'cf-connecting-ip': '203.0.113.10' } })).status).toBe(302)
  })

  it('honors keyed-only visibility and hidden profiles', async () => {
    const { app, index } = setup()
    index.rules.set(DID, { ...PUBLIC_VISIBILITY, keyedOnly: true, hiddenProfile: true })
    expect((await app.request('/u/alice.test?d=404')).status).toBe(404)
    expect((await app.request('/u/alice.test', { headers: { 'x-api-key': 'sk_test' } })).status).toBe(302)
    expect((await app.request('/profile/alice.test')).status).toBe(404)
  })

  it('stops serving inactive repos', async () => {
    const { app, index } = setup()
    index.inactive.add(DID)
    expect((await app.request('/u/alice.test?d=404')).status).toBe(404)
    expect((await app.request('/img/did%3Aplc%3Aabc123/bafyreiabc123/80.png')).status).toBe(404)
  })

  it('returns profile JSON', async () => {
    const { app } = setup()
    const body = await (await app.request('/profile/alice.test')).json()
    expect(body).toMatchObject({ did: DID, displayName: 'Alice', handle: 'alice.test', verifiedAccounts: [] })
  })

  it('serves resized images with immutable caching', async () => {
    const { app } = setup()
    const res = await app.request('/img/did%3Aplc%3Aabc123/bafyreiabc123/80.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('content-type')).toBe('image/png')
  })
})
