import { describe, expect, it } from 'vitest'
import { emailHash, type Candidate } from '@blueyvatar/core'
import { createApp, type AppDeps } from './app.js'
import { MemoryLicenseStore, MemoryRateLimiter } from './licenses.js'
import type { AvatarResolver, Identity } from './resolver.js'
import { MemoryIndexStore, PUBLIC_VISIBILITY } from './store.js'
import { MemoryAlertLedger, UsageAlerts, type UsageAlert } from './alerts.js'
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
      { key: { key: 'sk_biz', kind: 'secret', licenseId: 'L3', domains: [] }, license: { licenseId: 'L3', owner: DID, tier: 'business', status: 'active' } },
      { key: { key: 'sk_dead', kind: 'secret', licenseId: 'L2', domains: [] }, license: { licenseId: 'L2', owner: DID, tier: 'pro', status: 'suspended' } },
    ]),
    limiter: new MemoryRateLimiter(),
    resize: async () => new Uint8Array([9, 9]),
    profileBaseUrl: 'https://bv.test/',
    defaultUrlAllowlist: ['example.com'],
    trustCloudflare: true,
  }
  const sent: UsageAlert[] = []
  deps.alerts = new UsageAlerts({ send: async (x) => { sent.push(x) } }, new MemoryAlertLedger())
  return { app: createApp(deps), index, usage, sent, deps }
}

function setupDeps() { const { deps } = setup(); return { deps } }

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
    expect(res.headers.get('location')).toBe('/img/did%3Aplc%3Aabc123/bafyreiabc123/80-q60.webp')
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

  it('allows cross-origin reads of profile JSON', async () => {
    const { app } = setup()
    const res = await app.request('/profile/alice.test', { headers: { origin: 'https://site.test' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('returns profile JSON', async () => {
    const { app } = setup()
    const body = await (await app.request('/profile/alice.test')).json()
    expect(body).toMatchObject({ did: DID, displayName: 'Alice', handle: 'alice.test', verifiedAccounts: [] })
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
    const res = await app.request('/img/did%3Aplc%3Aabc123/bafyreiabc123/80.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('content-type')).toBe('image/png')
  })

  it('meters transforms and bytes against the DID, not a license', async () => {
    const { app, usage } = setup()
    await app.request('/img/did%3Aplc%3Aabc123/bafyreiabc123/80.png')
    expect(usage.service.get(`${DID}:transform`)).toBe(1)
    expect(usage.service.get(`${DID}:bytes_delivered`)).toBe(2)
    expect(usage.counts.size).toBe(0)
  })

  it('sends a usage alert when a keyed request reaches 80 percent', async () => {
    const { app, usage, sent } = setup()
    usage.counts.set('L1:origin_resolution', 39_999)
    await app.request('/u/alice.test', { headers: { 'x-api-key': 'sk_test' } })
    await app.request('/u/alice.test', { headers: { 'x-api-key': 'sk_test' } })
    expect(sent.map((a) => a.threshold)).toEqual([80])
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
      expect(res.headers.get('location')).toBe('/img/did%3Aplc%3Aabc123/bafyreiabc123/80.png')
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

    it('serves each variant path as its own object with the matching content type', async () => {
      const { app } = setup()
      const res = await app.request('/img/did%3Aplc%3Aabc123/bafyreiabc123/128-q60.webp')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/webp')
      expect((await app.request('/img/did%3Aplc%3Aabc123/bafyreiabc123/128-q101.webp')).status).toBe(404)
      expect((await app.request('/img/did%3Aplc%3Aabc123/bafyreiabc123/128.avif')).status).toBe(404)
    })

    describe('canonical /img URLs', () => {
      const base = '/img/did%3Aplc%3Aabc123/bafyreiabc123/'
      const get = (path: string) => setup().app.request(base + path)

      it('redirects an off-ladder size to the next ladder step without resizing', async () => {
        const { app, deps } = setup()
        let resizes = 0
        deps.resize = async () => { resizes++; return new Uint8Array([9, 9]) }
        const res = await app.request(`${base}100.png`)
        expect(res.status).toBe(302)
        expect(res.headers.get('location')).toBe(`${base}128.png`)
        expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
        expect(resizes).toBe(0)
      })

      it('redirects off-set qualities, PNG quality, and the redundant default quality', async () => {
        expect((await get('80-q70.webp')).headers.get('location')).toBe(`${base}80-q60.webp`)
        expect((await get('80-q100.jpeg')).headers.get('location')).toBe(`${base}80.jpeg`)
        expect((await get('80-q85.webp')).headers.get('location')).toBe(`${base}80.webp`)
        expect((await get('80-q60.png')).headers.get('location')).toBe(`${base}80.png`)
      })

      it('redirects any query string to the query-less canonical URL', async () => {
        const res = await get('80.png?x=1&v=2')
        expect(res.status).toBe(302)
        expect(res.headers.get('location')).toBe(`${base}80.png`)
      })

      it('redirects a non-canonical DID encoding to the canonical path', async () => {
        const res = await setup().app.request('/img/did:plc:abc123/bafyreiabc123/80.png')
        expect(res.status).toBe(302)
        expect(res.headers.get('location')).toBe(`${base}80.png`)
      })

      it('serves the redirect target as an immutable image', async () => {
        const { app } = setup()
        const loc = (await app.request(`${base}100.png?x=1`)).headers.get('location')!
        const res = await app.request(loc)
        expect(res.status).toBe(200)
        expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      })

      it('rejects sizes outside 1 to 2048 with a stable code', async () => {
        for (const f of ['0.png', '2049.png', '9999.png']) {
          const res = await get(f)
          expect(res.status).toBe(404)
          expect((await res.json()).error.code).toBe('invalid_size')
        }
      })

      it('rejects qualities outside 1 to 100 with a stable code', async () => {
        for (const f of ['80-q0.webp', '80-q101.webp']) {
          const res = await get(f)
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

describe('origin lockdown wiring', () => {
  it('createApp enforces originSecret and leaves /healthz open', async () => {
    const { deps } = setupDeps()
    const app = createApp({ ...deps, originSecret: 'k' })
    expect((await app.request('/healthz')).status).toBe(200)
    expect((await app.request(`/avatar/${emailHash('alice@example.com')}`)).status).toBe(403)
    expect((await app.request(`/avatar/${emailHash('alice@example.com')}`, { headers: { 'x-origin-auth': 'k' } })).status).toBe(302)
  })
})
