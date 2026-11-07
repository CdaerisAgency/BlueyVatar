import { describe, expect, it } from 'vitest'
import { GALLERY_MAX, emailHash, emailMd5, imagePath, restrictedScope, imageSig, qrSvg, type Candidate, type ImageFormat } from '@blueyvatar/core'
import { createApp, type AppDeps } from './app.js'
import { MemoryLicenseStore, MemoryRateLimiter } from './licenses.js'
import type { AvatarResolver, Identity } from './resolver.js'
import { MemoryIndexStore, PUBLIC_VISIBILITY } from './store.js'
import { MemoryAlertLedger, UsageAlerts, type UsageAlert } from './alerts.js'
import { MemoryUsageMeter } from './usage.js'

const DID = 'did:plc:abc123'
const CID = 'bafyreiabc123'
const SECRET = 'test-signing-secret'
const DAY = 86_400_000
/** Signed /img path as the redirect routes build it. */
const img = (size: number, format: ImageFormat = 'png', quality?: number, scope = '') => imagePath(SECRET, DID, CID, size, format, quality, scope)
/** Signed /img path for an arbitrary (possibly non-canonical) file name. */
const raw = (file: string) => `/img/did%3Aplc%3Aabc123/${CID}/${imageSig(SECRET, DID, CID, file)}/${file}`
const ident: Identity = { did: DID, handle: 'alice.test', pds: 'https://pds.test' }

function setup(candidates: Candidate[] = [{ source: 'adapter:bluesky', did: DID, blob: { cid: 'bafyreiabc123', mimeType: 'image/jpeg' }, rating: 'g' }]) {
  const index = new MemoryIndexStore()
  index.emails.set(emailHash('alice@example.com'), DID)
  const resolver: AvatarResolver = {
    resolveIdentity: async (id) => (id.value === DID || id.value === 'alice.test' ? ident : null),
    candidates: async () => candidates,
    galleryItems: async () => [],
    getRecord: async (_i, collection) => (collection === 'app.bsky.actor.profile' ? { displayName: 'Alice', links: [{ uri: `at://${DID}/app.bsky.actor.link/l1`, cid: 'cl1' }, { uri: `at://${DID}/app.bsky.actor.link/l2`, cid: 'cl2' }, { uri: `at://${DID}/app.bsky.actor.link/l3`, cid: 'stale' }] } : null),
    getBlob: async () => new Uint8Array([1, 2, 3]),
  }
  const usage = new MemoryUsageMeter()
  const deps: AppDeps = {
    index, resolver, usage,
    licenses: new MemoryLicenseStore([
      { key: { key: 'pk_test', kind: 'publishable', licenseId: 'L1', domains: ['*.example.com'] }, license: { licenseId: 'L1', owner: DID, tier: 'pro', status: 'active' } },
      { key: { key: 'sk_test', kind: 'secret', licenseId: 'L1', domains: [] }, license: { licenseId: 'L1', owner: DID, tier: 'pro', status: 'active' } },
      { key: { key: 'sk_biz', kind: 'secret', licenseId: 'L3', domains: [] }, license: { licenseId: 'L3', owner: DID, tier: 'business', status: 'active' } },
      { key: { key: 'sk_dead', kind: 'secret', licenseId: 'L2', domains: [] }, license: { licenseId: 'L2', owner: DID, tier: 'pro', status: 'suspended' } },
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

function setupDeps() { const { deps } = setup(); return { deps } }

describe('delivery API', () => {
  it('answers 404 for a blocked image on /img and skips it in redirects', async () => {
    const { app, index } = setup()
    index.blocked.add(`${DID}/bafyreiabc123`)
    expect((await app.request(img(80))).status).toBe(404)
  })

  it('redirects an email hash to an immutable image path', async () => {
    const { app } = setup()
    const res = await app.request(`/avatar/${emailHash('Alice@Example.com')}?s=4000`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(img(512))
    expect(res.headers.get('x-adjusted-params')).toBe('s')
    expect(res.headers.get('x-rate-limit-limit')).toBe('100')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('rejects a raw email in the hash position', async () => {
    const { app } = setup()
    const res = await app.request('/avatar/alice@example.com')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_identifier')
  })

  it('redirects an MD5 email hash exactly like its SHA256', async () => {
    const { app, index } = setup()
    index.md5s.set(emailMd5('alice@example.com'), emailHash('alice@example.com'))
    const sha = await app.request(`/avatar/${emailHash('alice@example.com')}?s=64`)
    const md5 = await app.request(`/avatar/${emailMd5('  Alice@Example.com ')}?s=64`)
    expect(md5.status).toBe(302)
    expect(md5.headers.get('location')).toBe(sha.headers.get('location'))
    expect(md5.headers.get('x-rate-limit-limit')).toBe('100')
    expect(md5.headers.get('set-cookie')).toBeNull()
    expect((await app.request(`/avatar/${emailMd5('alice@example.com').toUpperCase()}.png`)).status).toBe(302)
  })

  it('rejects hashes that are neither 32 nor 64 hex characters', async () => {
    const { app } = setup()
    for (const bad of ['a'.repeat(31), 'a'.repeat(33), 'a'.repeat(40), 'a'.repeat(63), 'a'.repeat(65), 'z'.repeat(32), 'alice@example.com']) {
      const res = await app.request(`/avatar/${bad}`)
      expect(res.status).toBe(400)
      expect((await res.json()).error.code).toBe('invalid_identifier')
    }
  })

  it('answers unlinked and opted-out hashes identically, for MD5 as for SHA256', async () => {
    const { app, index } = setup()
    index.md5s.set(emailMd5('alice@example.com'), emailHash('alice@example.com'))
    index.rules.set(DID, { ...PUBLIC_VISIBILITY, emailLookupOptOut: true })
    const shape = async (hash: string, d: string) => {
      const res = await app.request(`/avatar/${hash}?d=${d}`, { headers: { 'cf-connecting-ip': '203.0.113.50' } })
      return { status: res.status, cache: res.headers.get('cache-control'), body: await res.text() }
    }
    for (const d of ['404', 'mp']) {
      expect(await shape(emailMd5('alice@example.com'), d)).toEqual(await shape(emailMd5('nobody@example.com'), d))
      expect(await shape(emailHash('alice@example.com'), d)).toEqual(await shape(emailHash('nobody@example.com'), d))
    }
    expect((await shape(emailMd5('alice@example.com'), '404')).status).toBe(404)
  })

  it('applies visibility rules and the anonymous daily limit to MD5 lookups', async () => {
    const { app, index } = setup()
    const md5 = emailMd5('alice@example.com')
    index.md5s.set(md5, emailHash('alice@example.com'))
    index.rules.set(DID, { ...PUBLIC_VISIBILITY, keyedOnly: true })
    expect((await app.request(`/avatar/${md5}?d=404`)).status).toBe(404)
    expect((await app.request(`/avatar/${md5}`, { headers: { 'x-api-key': 'sk_test' } })).status).toBe(302)
    index.rules.clear()
    let last = 0
    for (let i = 0; i < 101; i++) last = (await app.request(`/avatar/${md5}`, { headers: { 'cf-connecting-ip': '203.0.113.77' } })).status
    expect(last).toBe(429)
  })

  it('sends retry-after on 429 and no x-cache-status on /img', async () => {
    const { app } = setup()
    const h = emailHash('alice@example.com')
    let res: Response | undefined
    for (let i = 0; i < 101; i++) res = await app.request(`/avatar/${h}`, { headers: { 'cf-connecting-ip': '203.0.113.88' } })
    expect(res!.status).toBe(429)
    const wait = Number(res!.headers.get('retry-after'))
    expect(wait).toBeGreaterThanOrEqual(1)
    expect(wait).toBeLessThanOrEqual(86_400)
    expect((await app.request(`/avatar/${h}`, { headers: { 'cf-connecting-ip': '203.0.113.89' } })).headers.get('retry-after')).toBeNull()
    expect((await app.request(img(80))).headers.get('x-cache-status')).toBeNull()
  })

  it('returns the standard JSON error for unhandled faults', async () => {
    const { app, deps } = setup()
    deps.resolver.resolveIdentity = async () => { throw new Error('boom') }
    const res = await app.request('/u/alice.test')
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('internal')
  })

  it('answers json=true in JSON with found false for missing, inactive, and restricted identities', async () => {
    const { app, index } = setup()
    const miss = { did: null, handle: null, found: false, source: 'default', rating: null, url: null, updatedDate: null }
    const unlinked = await app.request(`/avatar/${emailHash('nobody@example.com')}?json=true&d=404`)
    expect(unlinked.status).toBe(200)
    expect(await unlinked.json()).toEqual(miss)
    expect(await (await app.request('/u/unknown.test?json=true')).json()).toEqual(miss)
    index.inactive.add(DID)
    expect(await (await app.request('/u/alice.test?json=true')).json()).toEqual(miss)
    index.inactive.clear()
    index.rules.set(DID, { ...PUBLIC_VISIBILITY, keyedOnly: true })
    expect(await (await app.request(`/avatar/${emailHash('alice@example.com')}?json=true`)).json()).toEqual(miss)
    expect((await app.request('/u/alice.test?json=true&s=abc')).status).toBe(400)
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
    expect(res.headers.get('location')).toBe(img(80, 'webp', 70))
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
    expect((await app.request(img(80))).status).toBe(404)
  })

  it('allows cross-origin reads of profile JSON', async () => {
    const { app } = setup()
    const res = await app.request('/profile/alice.test', { headers: { origin: 'https://site.test', 'x-api-key': 'sk_biz' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('treats a profile with no candidates, as a labeled one yields, like any default response', async () => {
    const withAvatar = setup()
    const labeled = setup([])
    for (const path of ['/u/alice.test?d=identicon', `/avatar/${emailHash('alice@example.com')}?d=identicon`]) {
      const a = await withAvatar.app.request(path)
      const b = await labeled.app.request(path)
      expect(b.status).toBe(302)
      expect(b.headers.get('location')).toMatch(/^\/default\/identicon\/80\.png/)
      expect(b.headers.get('cache-control')).toBe('private, max-age=86400')
      expect(a.headers.get('location')).toMatch(/^\/img\//)
    }
    const json = await (await labeled.app.request('/u/alice.test?json=true')).json()
    expect(json).toMatchObject({ found: false, source: 'default', rating: null, url: null })
    expect((await (await labeled.app.request('/profile/alice.test')).json()).avatar).toBeNull()
  })

  describe('profile hovercard gating', () => {
    const cross = { origin: 'https://site.test' }
    it('rejects cross-origin callers without a Business key', async () => {
      const { app } = setup()
      for (const headers of [cross, { ...cross, 'x-api-key': 'sk_test' }]) {
        const res = await app.request('/profile/alice.test', { headers })
        expect(res.status).toBe(403)
        expect((await res.json()).error.code).toBe('tier_required')
      }
    })
    it('allows cross-origin callers with a Business key', async () => {
      const { app } = setup()
      const res = await app.request('/profile/alice.test', { headers: { ...cross, 'x-api-key': 'sk_biz' } })
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
    })
    it('keeps same-origin and server-to-server behavior', async () => {
      const { app } = setup()
      expect((await app.request('/profile/alice.test')).status).toBe(200)
      expect((await app.request('/profile/alice.test', { headers: { origin: 'https://bv.test' } })).status).toBe(200)
      expect((await app.request('http://delivery.test/profile/alice.test', { headers: { origin: 'http://delivery.test' } })).status).toBe(200)
    })
  })

  it('returns profile JSON', async () => {
    const { app } = setup()
    const body = await (await app.request('/profile/alice.test')).json()
    expect(body).toMatchObject({ did: DID, displayName: 'Alice', handle: 'alice.test', verifiedAccounts: [], links: [{ label: 'Site', url: 'https://alice.example/' }] })
  })

  it('returns attested accounts only, with hidden ones flagged and the Free cap applied', async () => {
    const { app, index } = setup()
    const acct = (n: number, hidden = false) => ({ platform: 'github', uri: `https://github.com/u${n}`, verifiedAt: `2026-01-0${n}T00:00:00.000Z`, hidden })
    index.accounts.set(DID, [acct(1), acct(2, true), acct(3), acct(4), acct(5)])
    const free = await (await app.request('/profile/alice.test')).json()
    expect(free.verifiedAccounts).toHaveLength(4)
    expect(free.verifiedAccounts[1]).toEqual({ platform: 'github', uri: 'https://github.com/u2', verifiedAt: '2026-01-02T00:00:00.000Z', hidden: true })
    const pro = await (await app.request('/profile/alice.test', { headers: { 'x-api-key': 'sk_test' } })).json()
    expect(pro.verifiedAccounts).toHaveLength(5)
  })

  it('serves resized images with immutable caching', async () => {
    const { app } = setup()
    const res = await app.request(img(80))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('content-type')).toBe('image/png')
  })

  it('meters transforms and bytes against the DID, not a license', async () => {
    const { app, usage } = setup()
    await app.request(img(80))
    expect(usage.service.get(`${DID}:transform`)).toBe(1)
    expect(usage.service.get(`${DID}:bytes_delivered`)).toBe(2)
    expect(usage.counts.size).toBe(0)
  })

  it('writes no usage meters or rate limit hits for a request with a valid warm header', async () => {
    const { deps, usage } = setup()
    const app = createApp({ ...deps, warmSecret: 'ws' })
    const warm = await app.request(img(80), { headers: { 'x-warm-auth': 'ws' } })
    expect(warm.status).toBe(200)
    expect(usage.service.size).toBe(0)
    expect(usage.counts.size).toBe(0)
    // A wrong secret is served as a normal, metered request.
    await app.request(img(80), { headers: { 'x-warm-auth': 'nope' } })
    expect(usage.service.get(`${DID}:transform`)).toBe(1)
  })

  it('ignores the warm header when WARM_SECRET is unset', async () => {
    const { app, usage } = setup()
    await app.request(img(80), { headers: { 'x-warm-auth': '' } })
    await app.request(img(80), { headers: { 'x-warm-auth': 'anything' } })
    expect(usage.service.get(`${DID}:transform`)).toBe(2)
  })

  it('sends a usage alert when a keyed request reaches 80 percent', async () => {
    const { app, usage, sent } = setup()
    usage.counts.set('L1:origin_resolution', 39_999)
    await app.request('/u/alice.test', { headers: { 'x-api-key': 'sk_test' } })
    await app.request('/u/alice.test', { headers: { 'x-api-key': 'sk_test' } })
    expect(sent.map((a) => a.threshold)).toEqual([80])
  })

  it('derives initials from name= on hash lookups', async () => {
    const { app } = setup()
    const h = emailHash('nobody@example.com')
    const r = await app.request(`/avatar/${h}?d=initials&name=${encodeURIComponent('Ada Lovelace King')}`)
    expect(r.headers.get('location')).toBe(`/default/initials/80.png?seed=${h}&initials=AL`)
    const one = await app.request(`/avatar/${h}?d=initials&name=grace`)
    expect(one.headers.get('location')).toContain('&initials=G')
    const none = await app.request(`/avatar/${h}?d=initials&name=%20%20`)
    expect(none.headers.get('location')).not.toContain('initials=')
  })

  it('serves d=blank as a transparent PNG default, even when another format is asked', async () => {
    const { app } = setup()
    const h = emailHash('nobody@example.com')
    const r = await app.request(`/avatar/${h}?d=blank&fmt=jpeg`)
    expect(r.headers.get('location')).toBe(`/default/blank/80.png?seed=${h}`)
    expect((await app.request('/default/blank/80.png')).status).toBe(200)
  })

  it('reports updatedDate in JSON mode', async () => {
    const { app } = setup([{ source: 'blueyvatar', did: DID, blob: { cid: CID, mimeType: 'image/png' }, rating: 'g', updatedAt: '2026-01-02T03:04:05.000Z' }])
    const json = await (await app.request('/u/alice.test?json=true')).json()
    expect(json.updatedDate).toBe('2026-01-02T03:04:05.000Z')
    const adapter = setup()
    expect((await (await adapter.app.request('/u/alice.test?json=true')).json()).updatedDate).toBeNull()
  })

  it('passes handle initials to the initials default, and none for hashes', async () => {
    const { app } = setup([])
    const byHandle = await app.request('/u/alice.test?d=initials')
    expect(byHandle.headers.get('location')).toBe('/default/initials/80.png?seed=alice.test&initials=AL')
    const byHash = await app.request(`/avatar/${emailHash('nobody@example.com')}?d=initials`)
    expect(byHash.headers.get('location')).not.toContain('initials=')
    const img = await app.request('/default/initials/80.png?seed=alice.test&initials=AL')
    expect(img.status).toBe(200)
  })

  describe('format and quality (F13)', () => {
    it('gives the free tier PNG only and reports ignored fmt and q', async () => {
      const { app } = setup()
      const res = await app.request('/u/alice.test?fmt=webp&q=70')
      expect(res.headers.get('location')).toBe(img(80))
      expect(res.headers.get('x-adjusted-params')).toBe('fmt,q')
    })

    it('encodes a non-default jpeg quality in the path, and omits quality for png and the default', async () => {
      const { app } = setup()
      const h = { 'x-api-key': 'sk_test' }
      expect((await app.request('/u/alice.test?fmt=jpeg&q=60', { headers: h })).headers.get('location')).toMatch(/\/80-q60\.jpeg$/)
      expect((await app.request('/u/alice.test?fmt=jpeg', { headers: h })).headers.get('location')).toMatch(/\/80\.jpeg$/)
      expect((await app.request('/u/alice.test?fmt=png&q=40', { headers: h })).headers.get('location')).toMatch(/\/80\.png$/)
    })

    it('rejects unknown formats and out-of-range quality', async () => {
      const { app } = setup()
      const h = { 'x-api-key': 'sk_test' }
      expect((await (await app.request('/u/alice.test?fmt=avif', { headers: h })).json()).error.code).toBe('invalid_format')
      expect((await (await app.request('/u/alice.test?fmt=webp&q=0', { headers: h })).json()).error.code).toBe('invalid_quality')
      expect((await (await app.request('/u/alice.test?fmt=webp&q=101', { headers: h })).json()).error.code).toBe('invalid_quality')
    })

    it('rejects q=abc, fmt=gif, and uppercase fmt with stable codes', async () => {
      const { app } = setup()
      for (const [qs, code] of [['q=abc', 'invalid_quality'], ['fmt=gif', 'invalid_format'], ['fmt=WEBP', 'invalid_format'], ['fmt=PNG', 'invalid_format']] as const) {
        for (const headers of [{ 'x-api-key': 'sk_test' }, {}]) {
          const res = await app.request(`/u/alice.test?${qs}`, { headers })
          expect(res.status).toBe(400)
          expect((await res.json()).error.code).toBe(code)
        }
      }
    })

    it('accepts q=1 and q=100 on pro and business, snapping the path to an allowed quality', async () => {
      const { app } = setup()
      for (const key of ['sk_test', 'sk_biz']) {
        const h = { 'x-api-key': key }
        const low = await app.request('/u/alice.test?fmt=webp&q=1', { headers: h })
        expect(low.headers.get('location')).toBe(img(80, 'webp', 60))
        expect(low.headers.get('x-adjusted-params')).toBeNull()
        const high = await app.request('/u/alice.test?fmt=jpeg&q=100', { headers: h })
        expect(high.headers.get('location')).toBe(img(80, 'jpeg'))
      }
    })

    it('gives every format its own distinct signed path', async () => {
      const paths = new Set([img(80), img(80, 'jpeg'), img(80, 'webp'), img(80, 'jpeg', 60), img(80, 'webp', 60)])
      expect(paths.size).toBe(5)
    })

    it('serves each variant path as its own object with the matching content type', async () => {
      const { app } = setup()
      const res = await app.request(img(128, 'webp', 60))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/webp')
      expect((await app.request(raw('128-q101.webp'))).status).toBe(404)
      expect((await app.request(img(128).replace(/\.png$/, '.avif'))).status).toBe(404)
    })
  })

  describe('signed image paths (issues #68 and #72)', () => {
    const sigOf = (path: string) => path.split('/')[4]!

    it('serves a validly signed path and rejects an unsigned one', async () => {
      const { app } = setup()
      expect((await app.request(img(80))).status).toBe(200)
      const bare = await app.request(`/img/did%3Aplc%3Aabc123/${CID}/80.png`)
      expect(bare.status).toBe(403)
      expect((await bare.json()).error.code).toBe('invalid_signature')
    })

    it('rejects a tampered size, so the Free tier cap holds on /img', async () => {
      const { app } = setup()
      const free = await app.request('/u/alice.test?s=2048')
      const granted = free.headers.get('location')!
      expect(granted).toBe(img(512))
      const res = await app.request(granted.replace('/512.png', '/2048.png'))
      expect(res.status).toBe(403)
      expect((await res.json()).error.code).toBe('invalid_signature')
      expect((await app.request(granted.replace('/512.png', '/512-q50.jpeg'))).status).toBe(403)
    })

    it('rejects a tampered CID and a signature made with another secret', async () => {
      const { app } = setup()
      expect((await app.request(img(80).replace(CID, 'bafyreiother1'))).status).toBe(403)
      const other = imagePath('other-secret', DID, CID, 80, 'png')
      expect((await app.request(other)).status).toBe(403)
    })

    it('gives a public avatar the same URL to every caller', async () => {
      const { app } = setup()
      const anon = (await app.request('/u/alice.test')).headers.get('location')
      const keyed = (await app.request('/u/alice.test', { headers: { 'x-api-key': 'sk_test' } })).headers.get('location')
      const site = (await app.request('/u/alice.test?token=pk_test', { headers: { origin: 'https://app.example.com' } })).headers.get('location')
      expect(anon).toBe(img(80))
      expect(keyed).toBe(anon)
      expect(site).toBe(anon)
      expect(sigOf(anon!)).not.toContain('.')
    })

    it('scopes restricted avatars to the caller and the day, and expires them', async () => {
      const { app, index, deps } = setup()
      let now = 20_000 * DAY + 1000
      deps.now = () => now
      index.rules.set(DID, { ...PUBLIC_VISIBILITY, keyedOnly: true })
      const keyed = (await app.request('/u/alice.test', { headers: { 'x-api-key': 'sk_test' } })).headers.get('location')!
      expect(keyed).toBe(img(80, 'png', undefined, 'k:L1:20000'))
      expect((await app.request(keyed)).status).toBe(200)
      // A second key gets its own URL; the public-scope URL is refused once restricted.
      const biz = (await app.request('/u/alice.test', { headers: { 'x-api-key': 'sk_biz' } })).headers.get('location')!
      expect(biz).not.toBe(keyed)
      expect((await app.request(biz)).status).toBe(200)
      expect((await (await app.request(img(80))).json()).error.code).toBe('access_denied')
      // Valid through the next day, then expired.
      now += DAY
      expect((await app.request(keyed)).status).toBe(200)
      now += DAY
      const expired = await app.request(keyed)
      expect(expired.status).toBe(403)
      expect((await expired.json()).error.code).toBe('signature_expired')
      // A domain allowlist scopes to the origin host.
      index.rules.set(DID, { ...PUBLIC_VISIBILITY, domainAllowlist: ['app.example.com'] })
      const site = (await app.request('/u/alice.test', { headers: { origin: 'https://app.example.com' } })).headers.get('location')!
      expect(site).toBe(img(80, 'png', undefined, 'd:app.example.com:20002'))
      expect((await app.request(site)).status).toBe(200)
    })

    it('signs the avatar URL in profile JSON', async () => {
      const { app } = setup()
      const body = await (await app.request('/profile/alice.test')).json()
      expect(body.avatar.url).toBe(img(256))
    })

    describe('canonical /img URLs', () => {
      const get = (path: string) => setup().app.request(path)

      it('redirects a signed off-ladder size to the signed next ladder step without resizing', async () => {
        const { app, deps } = setup()
        let resizes = 0
        deps.resize = async () => { resizes++; return new Uint8Array([9, 9]) }
        const res = await app.request(raw('100.png'))
        expect(res.status).toBe(302)
        expect(res.headers.get('location')).toBe(img(128))
        expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
        expect(resizes).toBe(0)
      })

      it('redirects off-set qualities, PNG quality, and the redundant default quality', async () => {
        expect((await get(raw('80-q70.webp'))).headers.get('location')).toBe(img(80, 'webp', 60))
        expect((await get(raw('80-q100.jpeg'))).headers.get('location')).toBe(img(80, 'jpeg'))
        expect((await get(raw('80-q85.webp'))).headers.get('location')).toBe(img(80, 'webp'))
        expect((await get(raw('80-q60.png'))).headers.get('location')).toBe(img(80))
      })

      it('redirects any query string to the query-less canonical URL', async () => {
        const res = await get(`${img(80)}?x=1&v=2`)
        expect(res.status).toBe(302)
        expect(res.headers.get('location')).toBe(img(80))
      })

      it('redirects a non-canonical DID encoding to the canonical path', async () => {
        const res = await get(img(80).replace('did%3Aplc%3Aabc123', 'did:plc:abc123'))
        expect(res.status).toBe(302)
        expect(res.headers.get('location')).toBe(img(80))
      })

      it('does not redirect an unsigned off-ladder path', async () => {
        expect((await get(`/img/did%3Aplc%3Aabc123/${CID}/100.png`)).status).toBe(403)
      })

      it('serves the redirect target as an immutable image', async () => {
        const { app } = setup()
        const loc = (await app.request(`${raw('100.png')}?x=1`)).headers.get('location')!
        const res = await app.request(loc)
        expect(res.status).toBe(200)
        expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      })

      it('rejects sizes outside 1 to 2048 with a stable code', async () => {
        for (const f of ['0.png', '2049.png', '9999.png']) {
          const res = await get(raw(f))
          expect(res.status).toBe(404)
          expect((await res.json()).error.code).toBe('invalid_size')
        }
      })

      it('rejects qualities outside 1 to 100 with a stable code', async () => {
        for (const f of ['80-q0.webp', '80-q101.webp']) {
          const res = await get(raw(f))
          expect(res.status).toBe(404)
          expect((await res.json()).error.code).toBe('invalid_quality')
        }
      })

      it('emits avatar redirects that /img serves directly', async () => {
        const { app } = setup()
        const hdr = { 'x-api-key': 'sk_test' }
        for (const q of ['s=100', 's=1000&fmt=webp&q=70', 's=17&fmt=jpeg&q=1', 's=512&fmt=png&q=60']) {
          const loc = (await app.request(`/u/did:plc:abc123?${q}`, { headers: hdr })).headers.get('location')!
          expect((await app.request(loc)).status).toBe(200)
        }
      })
    })
  })

  describe('cache ttl (F16)', () => {
    const ttlOf = (res: Response) => res.headers.get('cache-control')

    it('fixes the free tier at 24h and reports ttl as adjusted', async () => {
      const { app } = setup()
      const res = await app.request('/u/alice.test?ttl=7d')
      expect(ttlOf(res)).toBe('private, max-age=86400')
      expect(res.headers.get('x-adjusted-params')).toBe('ttl')
    })

    it('applies ttl from 1h to 28d on paid tiers to the redirect', async () => {
      const { app } = setup()
      const h = { 'x-api-key': 'sk_test' }
      expect(ttlOf(await app.request('/u/alice.test?ttl=1h', { headers: h }))).toBe('private, max-age=3600')
      expect(ttlOf(await app.request('/u/alice.test?ttl=28d', { headers: h }))).toBe('private, max-age=2419200')
      expect(ttlOf(await app.request('/u/alice.test?ttl=6h', { headers: h }))).toBe('private, max-age=21600')
      const res = await app.request('/u/alice.test?ttl=6h', { headers: h })
      expect(res.headers.get('x-adjusted-params')).toBeNull()
    })

    it('rejects ttl outside the range or without a unit', async () => {
      const { app } = setup()
      const h = { 'x-api-key': 'sk_test' }
      for (const bad of ['30m', '29d', '0h', '3600', '1w']) {
        const res = await app.request(`/u/alice.test?ttl=${bad}`, { headers: h })
        expect(res.status).toBe(400)
        expect((await res.json()).error.code).toBe('invalid_ttl')
      }
    })

    it('applies the same ttl to JSON responses and the default redirect', async () => {
      const { app } = setup()
      const h = { 'x-api-key': 'sk_test' }
      const json = await app.request('/u/alice.test?json=true&ttl=2d', { headers: h })
      expect(ttlOf(json)).toBe('private, max-age=172800')
      expect((await json.json()).found).toBe(true)
      const { app: empty } = setup([])
      expect(ttlOf(await empty.request('/u/alice.test?ttl=2d', { headers: h }))).toBe('private, max-age=172800')
    })
  })

  describe('QR code (F23)', () => {
    const biz = { 'x-api-key': 'sk_biz' }

    it('requires a Business or Enterprise key', async () => {
      const { app } = setup()
      const anon = await app.request('/qr/alice.test.svg')
      expect(anon.status).toBe(403)
      expect((await anon.json()).error.code).toBe('tier_required')
      expect((await app.request('/qr/alice.test.svg', { headers: { 'x-api-key': 'sk_test' } })).status).toBe(403)
    })

    it('returns an SVG for a handle with the requested size and private caching', async () => {
      const { app, usage } = setup()
      const res = await app.request('/qr/alice.test.svg?s=300', { headers: biz })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/svg+xml')
      expect(res.headers.get('cache-control')).toBe('private, max-age=86400')
      const svg = await res.text()
      expect(svg).toContain('width="300" height="300"')
      expect(svg.startsWith('<svg')).toBe(true)
      expect(usage.counts.get('L3:origin_resolution')).toBe(1)
    })

    it('defaults the size, clamps to the tier cap, and honors ttl', async () => {
      const { app } = setup()
      expect(await (await app.request('/qr/alice.test.svg', { headers: biz })).text()).toContain('width="256"')
      const big = await app.request('/qr/alice.test.svg?s=4000&ttl=2d', { headers: biz })
      expect(await big.text()).toContain('width="2048"')
      expect(big.headers.get('cache-control')).toBe('private, max-age=172800')
    })

    it('accepts a DID and an email hash, and rasterizes PNG through the resizer', async () => {
      const { app } = setup()
      expect((await app.request(`/qr/${DID}.svg`, { headers: biz })).status).toBe(200)
      expect((await app.request(`/qr/${emailHash('alice@example.com')}.svg`, { headers: biz })).status).toBe(200)
      const png = await app.request('/qr/alice.test.png?s=200', { headers: biz })
      expect(png.headers.get('content-type')).toBe('image/png')
      expect([...new Uint8Array(await png.arrayBuffer())]).toEqual([9, 9])
    })

    it('encodes the /go URL when ?to= is given and rejects a bad platform', async () => {
      const { app } = setup()
      const plain = await (await app.request('/qr/alice.test.svg', { headers: biz })).text()
      const to = await app.request('/qr/alice.test.svg?to=github', { headers: biz })
      expect(to.status).toBe(200)
      const goSvg = await to.text()
      expect(goSvg).not.toBe(plain)
      expect(goSvg).toBe(qrSvg('https://bv.test/go/alice.test/github', 256))
      expect(plain).toBe(qrSvg('https://bv.test/p/alice.test', 256))
      const bad = await app.request('/qr/alice.test.svg?to=BAD!', { headers: biz })
      expect(bad.status).toBe(400)
      expect((await bad.json()).error.code).toBe('invalid_platform')
    })

    it('returns 404 for hidden profiles, unknown identities, and bad extensions', async () => {
      const { app, index } = setup()
      expect((await app.request('/qr/nobody.test.svg', { headers: biz })).status).toBe(404)
      expect((await app.request('/qr/alice.test.gif', { headers: biz })).status).toBe(404)
      expect((await app.request('/qr/alice.test', { headers: biz })).status).toBe(404)
      index.rules.set(DID, { ...PUBLIC_VISIBILITY, hiddenProfile: true })
      expect((await app.request('/qr/alice.test.svg', { headers: biz })).status).toBe(404)
    })
  })
})

describe('GET /go/:handle/:platform', () => {
  const acct = (platform: string, uri: string, hidden = false) => ({ platform, uri, verifiedAt: '2026-01-01T00:00:00.000Z', hidden })

  it('redirects to a verified platform uri, case-insensitively, with private caching', async () => {
    const { app, index } = setup()
    index.accounts.set(DID, [acct('github', 'https://github.com/alice')])
    const res = await app.request('/go/alice.test/GitHub')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://github.com/alice')
    expect(res.headers.get('cache-control')).toBe('private, max-age=60')
  })

  it('sends bluesky to bsky.app', async () => {
    const { app } = setup()
    expect((await app.request('/go/alice.test/bluesky')).headers.get('location')).toBe('https://bsky.app/profile/alice.test')
  })

  it('falls back to the profile page for unverified, hidden, and non-https entries', async () => {
    const { app, index } = setup()
    index.accounts.set(DID, [acct('github', 'https://github.com/alice', true), acct('website', 'http://alice.example')])
    for (const platform of ['github', 'website', 'mastodon']) {
      const res = await app.request(`/go/alice.test/${platform}`)
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('https://bv.test/p/alice.test')
    }
  })

  it('returns 404 for unknown handles and hidden profiles alike', async () => {
    const { app, index } = setup()
    expect((await app.request('/go/nobody.test/github')).status).toBe(404)
    index.rules.set(DID, { ...PUBLIC_VISIBILITY, hiddenProfile: true })
    expect((await app.request('/go/alice.test/github')).status).toBe(404)
  })
})

describe('origin lockdown wiring', () => {
  it('createApp enforces originSecret and leaves /healthz open', async () => {
    const { deps } = setupDeps()
    const app = createApp({ ...deps, originSecret: 'k' })
    expect((await app.request('/healthz')).status).toBe(200)
    expect((await app.request(`/avatar/${emailHash('alice@example.com')}`)).status).toBe(403)
    expect((await app.request(`/avatar/${emailHash('alice@example.com')}`, { headers: { 'x-origin-auth': 'k' } })).status).toBe(302)
  })

  describe('hash enumeration (issue 59)', () => {
    const summarize = (r: Response) => ({
      status: r.status,
      location: r.headers.get('location'),
      cacheControl: r.headers.get('cache-control'),
      contentType: r.headers.get('content-type'),
    })

    it('answers unlinked, opted-out, and restricted hashes identically', async () => {
      const { app, index } = setup()
      const unlinked = emailHash('nobody@example.com')
      const optedOut = emailHash('optout@example.com')
      const restricted = emailHash('restricted@example.com')
      const inactive = emailHash('gone@example.com')
      index.emails.set(optedOut, 'did:plc:optout')
      index.rules.set('did:plc:optout', { ...PUBLIC_VISIBILITY, emailLookupOptOut: true })
      index.emails.set(restricted, 'did:plc:restricted')
      index.rules.set('did:plc:restricted', { ...PUBLIC_VISIBILITY, keyedOnly: true })
      index.emails.set(inactive, 'did:plc:gone')
      index.inactive.add('did:plc:gone')

      for (const query of ['', '?d=identicon', '?d=404']) {
        const results = []
        for (const h of [unlinked, optedOut, restricted, inactive]) {
          const res = await app.request(`/avatar/${h}${query}`)
          const { location, ...rest } = summarize(res)
          // The seed is the requested hash, so only the seed may differ in the redirect target.
          results.push({ ...rest, location: location?.replace(h, 'HASH') ?? null, body: await res.text() })
        }
        for (const r of results.slice(1)) expect(r).toEqual(results[0])
      }
    })

    it('does not resolve identities for hashes the caller may not see', async () => {
      const { deps, index } = setup()
      const restricted = emailHash('restricted@example.com')
      index.emails.set(restricted, 'did:plc:restricted')
      index.rules.set('did:plc:restricted', { ...PUBLIC_VISIBILITY, domainAllowlist: ['only.example'] })
      let resolved = 0
      const app = createApp({ ...deps, resolver: { ...deps.resolver, resolveIdentity: async (i) => { resolved++; return deps.resolver.resolveIdentity(i) } } })
      await app.request(`/avatar/${restricted}`)
      expect(resolved).toBe(0)
    })

    it('still serves a restricted avatar to a caller that passes the rule', async () => {
      const { app, index } = setup()
      index.rules.set(DID, { ...PUBLIC_VISIBILITY, keyedOnly: true })
      const h = emailHash('alice@example.com')
      expect((await app.request(`/avatar/${h}`)).headers.get('location')).toMatch(/^\/default\//)
      const ok = await app.request(`/avatar/${h}`, { headers: { 'x-api-key': 'sk_test' } })
      expect(ok.headers.get('location')).toMatch(/^\/img\//)
    })

    it('profile and QR lookups by hash return 404 for restricted, like unlinked', async () => {
      const { app, index } = setup()
      index.rules.set(DID, { ...PUBLIC_VISIBILITY, keyedOnly: true })
      const restricted = await app.request(`/profile/${emailHash('alice@example.com')}`)
      const unlinked = await app.request(`/profile/${emailHash('nobody@example.com')}`)
      expect(restricted.status).toBe(404)
      expect(await restricted.json()).toEqual(await unlinked.json())
    })
  })
})

describe('profile gallery (F21)', () => {
  const items = (n: number, rating: 'g' | 'pg' | 'r' | 'x' = 'g') => Array.from({ length: n }, (_, i) => ({ cid: `bafygal${i}`, rating, caption: i === 0 ? 'First' : null }))
  function galleryApp(list: ReturnType<typeof items>, plusDids: string | undefined) {
    const { deps } = setup()
    deps.resolver = { ...deps.resolver, galleryItems: async () => list }
    deps.plusDids = plusDids
    return createApp(deps)
  }
  const gal = async (app: ReturnType<typeof createApp>) => (await (await app.request('/profile/alice.test')).json()).gallery

  it('returns an empty gallery for Free users', async () => {
    expect(await gal(galleryApp(items(3), undefined))).toEqual([])
    expect(await gal(galleryApp(items(3), 'did:plc:someoneelse'))).toEqual([])
  })

  it('returns signed /img paths and captions for Plus users', async () => {
    const g = await gal(galleryApp(items(2), `did:plc:x, ${DID}`))
    expect(g).toEqual([
      { url: imagePath(SECRET, DID, 'bafygal0', 512, 'png', undefined, ''), caption: 'First' },
      { url: imagePath(SECRET, DID, 'bafygal1', 512, 'png', undefined, ''), caption: null },
    ])
    expect(g.every((x: { url: string }) => x.url.startsWith('/img/'))).toBe(true)
  })

  it('applies the avatar rating filter', async () => {
    const list = [...items(1, 'g'), { cid: 'bafypg', rating: 'pg' as const, caption: null }, { cid: 'bafyr', rating: 'r' as const, caption: null }, { cid: 'bafyx', rating: 'x' as const, caption: null }]
    expect(await gal(galleryApp(list, DID))).toHaveLength(1)
  })

  it('caps the gallery at 12', async () => {
    expect(GALLERY_MAX).toBe(12)
    expect(await gal(galleryApp(items(20), DID))).toHaveLength(12)
  })

  it('signs restricted galleries with the caller scope, like avatars', async () => {
    const { deps, index } = (() => { const s = setup(); return { deps: s.deps, index: s.index } })()
    index.rules.set(DID, { ...PUBLIC_VISIBILITY, keyedOnly: true })
    deps.resolver = { ...deps.resolver, galleryItems: async () => items(1) }
    deps.plusDids = DID
    const app = createApp({ ...deps, now: () => 0 })
    const res = await app.request('/profile/alice.test', { headers: { 'x-api-key': 'sk_test' } })
    expect((await res.json()).gallery[0].url).toBe(imagePath(SECRET, DID, 'bafygal0', 512, 'png', undefined, restrictedScope('k:L1', 0)))
  })
})
