import { describe, expect, it } from 'vitest'
import jsQR from 'jsqr'
import sharp from 'sharp'
import { buildMarkdown, buildVcard, emailHash, qrLayout, toExportProfile, type Candidate } from '@blueyvatar/core'
import { readFileSync } from 'node:fs'
import { createApp, type AppDeps } from './app.js'
import { MemoryLicenseStore, MemoryRateLimiter } from './licenses.js'
import type { AvatarResolver, Identity } from './resolver.js'
import { MemoryIndexStore, PUBLIC_VISIBILITY } from './store.js'
import { MemoryUsageMeter } from './usage.js'
import type { Resizer } from './resize.js'

const DID = 'did:plc:abc123'
const ident: Identity = { did: DID, handle: 'alice.test', pds: 'https://pds.test' }
const BASE = 'https://bv.test'
const URL_OF_PROFILE = `${BASE}/p/alice.test`
const biz = { 'x-api-key': 'sk_biz' }

/** The same sharp calls the resize worker makes for these jobs, without the child process. */
const realResize: Resizer = async ({ input, size }) =>
  sharp(Buffer.from(input), { failOn: 'warning' }).resize(size, size, { fit: 'cover', position: 'centre' }).png().toBuffer()

/** A busy avatar: bold stripes and noise-like squares, 300 px, so it is a hard center for a decoder. */
async function avatarPng(): Promise<Uint8Array> {
  const tiles = Array.from({ length: 36 }, (_, i) => ({
    input: { create: { width: 50, height: 50, channels: 3 as const, background: { r: (i * 53) % 256, g: (i * 97) % 256, b: (i * 193) % 256 } } },
    left: (i % 6) * 50,
    top: Math.floor(i / 6) * 50,
  }))
  return new Uint8Array(await sharp({ create: { width: 300, height: 300, channels: 3, background: '#000' } }).composite(tiles).png().toBuffer())
}

const LOGO = new Uint8Array(readFileSync(new URL('../../web/public/logo.jpg', import.meta.url)))

function setup(opts: { candidates?: Candidate[]; own?: Record<string, unknown>; avatar?: Uint8Array } = {}) {
  const index = new MemoryIndexStore()
  const candidates = opts.candidates ?? [{ source: 'adapter:bluesky', did: DID, blob: { cid: 'bafyreiabc123', mimeType: 'image/png' }, rating: 'g' as const }]
  const resolver: AvatarResolver = {
    resolveIdentity: async (id) => (id.value === DID || id.value === 'alice.test' ? ident : null),
    candidates: async () => candidates,
    galleryItems: async () => [],
    getRecord: async (_i, collection) =>
      collection === 'app.bsky.actor.profile'
        ? { displayName: 'Alice; "Al", 😀', description: 'Line one\n[x](https://evil.test) <b>hi</b>' }
        : { jobTitle: 'Dev', company: 'Acme, Inc.', location: 'Berlin', pronouns: 'she/her', interests: ['chess'], ...opts.own },
    getBlob: async () => opts.avatar ?? new Uint8Array([1]),
    repoApps: async () => [],
  }
  index.emails.set(emailHash('alice@example.com'), DID)
  const deps: AppDeps = {
    index, resolver, usage: new MemoryUsageMeter(),
    licenses: new MemoryLicenseStore([
      { key: { key: 'sk_biz', kind: 'secret', licenseId: 'L3', domains: [] }, license: { licenseId: 'L3', owner: DID, tier: 'business', status: 'active' } },
    ]),
    limiter: new MemoryRateLimiter(),
    resize: realResize,
    profileBaseUrl: BASE + '/',
    publicUrl: 'https://img.bv.test',
    qrLogo: LOGO,
    defaultUrlAllowlist: [],
    trustCloudflare: true,
    imgSigningSecret: 'secret',
  }
  return { app: createApp(deps), index, deps }
}

describe('profile exports', () => {
  const walletOwn = { wallets: [{ chain: 'Bitcoin', address: 'bc1qshown', visible: true }, { chain: 'Ethereum', address: '0xhidden', visible: false }], languages: [{ tag: 'en', primary: true }], socialLinks: [{ label: 'Blog', url: 'https://blog.example/' }] }

  it('serves JSON, Markdown, and vCard with the right headers', async () => {
    const { app } = setup({ own: walletOwn })
    const want = { json: ['application/json; charset=utf-8', 'alice.test.json'], md: ['text/markdown; charset=utf-8', 'alice.test.md'], vcf: ['text/vcard; charset=utf-8', 'alice.test.vcf'] } as const
    for (const [ext, [type, name]] of Object.entries(want)) {
      const res = await app.request(`/profile/alice.test.${ext}`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe(type)
      expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${name}"`)
      expect(res.headers.get('cache-control')).toBe('private, max-age=300')
      expect(res.headers.get('x-rate-limit-limit')).toBe('100')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    }
    const json = JSON.parse(await (await app.request('/profile/alice.test.json')).text())
    expect(json).toMatchObject({ handle: 'alice.test', displayName: 'Alice; "Al", 😀', profileUrl: URL_OF_PROFILE, jobTitle: 'Dev', wallets: [{ chain: 'Bitcoin', address: 'bc1qshown', verified: false }] })
    expect(json.avatarUrl).toMatch(/^https:\/\/img\.bv\.test\/img\//)
    const vcf = await (await app.request('/profile/alice.test.vcf')).text()
    expect(vcf).toBe(buildVcard(toExportProfile({ profile: await (await app.request('/profile/alice.test')).json(), deliveryOrigin: 'https://img.bv.test', profileBaseUrl: BASE })))
    expect(vcf.startsWith('BEGIN:VCARD\r\nVERSION:4.0\r\n')).toBe(true)
    const md = await (await app.request('/profile/alice.test.md')).text()
    expect(md).toContain('## Wallets (not verified)')
    expect(md).not.toContain('<b>')
    expect(md).toBe(buildMarkdown(toExportProfile({ profile: await (await app.request('/profile/alice.test')).json(), deliveryOrigin: 'https://img.bv.test', profileBaseUrl: BASE })))
  })

  it('never exports hidden wallets, the DID, or owner-only data', async () => {
    const { app } = setup({ own: walletOwn })
    for (const ext of ['json', 'md', 'vcf']) {
      const body = await (await app.request(`/profile/alice.test.${ext}`)).text()
      for (const secret of ['0xhidden', DID, 'did:plc', emailHash('alice@example.com'), 'plan']) expect(body).not.toContain(secret)
    }
  })

  it('keeps the existing JSON URL, ?format=, and handles that end in a suffix working', async () => {
    const { app } = setup()
    const plain = await app.request('/profile/alice.test')
    expect(plain.headers.get('content-type')).toContain('application/json')
    expect(plain.headers.get('content-disposition')).toBeNull()
    expect((await plain.json()).did).toBe(DID)
    const q = await app.request('/profile/alice.test?format=vcf')
    expect(q.headers.get('content-type')).toBe('text/vcard; charset=utf-8')
    expect((await app.request('/profile/alice.test?format=bogus')).headers.get('content-type')).toContain('application/json')
    // A DID and an email hash work with a suffix too.
    expect((await app.request(`/profile/${DID}.json`)).status).toBe(200)
    expect((await app.request(`/profile/${emailHash('alice@example.com')}.md`)).status).toBe(200)
  })

  it('treats a handle ending in .md as that handle first', async () => {
    const { app, deps } = setup()
    const base = deps.resolver.resolveIdentity
    deps.resolver.resolveIdentity = async (id) => (id.value === 'bob.example.md' ? { did: 'did:plc:bob', handle: 'bob.example.md', pds: 'https://p.test' } : base(id))
    const whole = await app.request('/profile/bob.example.md')
    expect(whole.headers.get('content-type')).toContain('application/json')
    expect((await whole.json()).handle).toBe('bob.example.md')
    expect((await app.request('/profile/alice.test.md')).headers.get('content-type')).toContain('text/markdown')
  })

  it('answers 404 for unknown, hidden, and inactive profiles and applies the rating-free rules of the profile route', async () => {
    const { app, index } = setup()
    for (const ext of ['json', 'md', 'vcf']) expect((await app.request(`/profile/nobody.test.${ext}`)).status).toBe(404)
    expect((await app.request('/profile/nobody.test?format=md')).status).toBe(404)
    index.rules.set(DID, { ...PUBLIC_VISIBILITY, hiddenProfile: true })
    for (const ext of ['json', 'md', 'vcf']) expect((await app.request(`/profile/alice.test.${ext}`)).status).toBe(404)
    index.rules.set(DID, PUBLIC_VISIBILITY)
    index.inactive.add(DID)
    expect((await app.request('/profile/alice.test.vcf')).status).toBe(404)
  })

  it('uses the same rate limit, metering, and restricted-profile rules as /profile', async () => {
    const { app, index, deps } = setup()
    const usage = deps.usage as MemoryUsageMeter
    await app.request('/profile/alice.test.json', { headers: biz })
    expect(usage.counts.get('L3:profile_json')).toBe(1)
    index.rules.set(DID, { ...PUBLIC_VISIBILITY, keyedOnly: true })
    expect((await app.request('/profile/alice.test.json')).status).toBe(403)
    expect((await app.request('/profile/alice.test.json', { headers: biz })).status).toBe(200)
    expect((await app.request(`/profile/${emailHash('alice@example.com')}.vcf`)).status).toBe(404)
  })

  it('answers with the cross-origin rule of /profile', async () => {
    const { app } = setup()
    const res = await app.request('/profile/alice.test.json', { headers: { origin: 'https://other.test' } })
    expect(res.status).toBe(403)
  })
})

async function decode(png: Uint8Array): Promise<string | null> {
  const { data, info } = await sharp(Buffer.from(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null
}

describe('QR codes decode to the profile URL', () => {
  const sizes = [200, 256, 333, 400, 512, 777, 1024, 2048]
  for (const center of ['none', 'logo', 'avatar'] as const) {
    it(`center=${center} at several sizes and quiet zones`, async () => {
      const avatar = await avatarPng()
      const { app } = setup({ avatar })
      for (const size of sizes) {
        for (const quiet of [undefined, '4', '10']) {
          const res = await app.request(`/qr/alice.test.png?s=${size}&center=${center}${quiet ? `&quiet=${quiet}` : ''}`, { headers: biz })
          expect(res.status).toBe(200)
          expect(res.headers.get('content-type')).toBe('image/png')
          const png = new Uint8Array(await res.arrayBuffer())
          const meta = await sharp(Buffer.from(png)).metadata()
          const layout = qrLayout(URL_OF_PROFILE, { size, quiet: quiet ? Number(quiet) : 4, center: center !== 'none' })
          expect(meta.width).toBe(layout.pixels)
          expect(meta.height).toBe(layout.pixels)
          expect(Number(res.headers.get('x-qr-pixels'))).toBe(layout.pixels)
          expect(Number(res.headers.get('x-qr-modules'))).toBe(layout.modules)
          expect(layout.pixels).toBeLessThanOrEqual(Math.max(size, layout.totalModules * 4))
          expect(await decode(png)).toBe(URL_OF_PROFILE)
        }
      }
    })
  }

  it('still decodes after the image is shrunk and blurred, the way a camera sees it', async () => {
    const { app } = setup({ avatar: await avatarPng() })
    for (const center of ['logo', 'avatar']) {
      const png = new Uint8Array(await (await app.request(`/qr/alice.test.png?s=1024&center=${center}`, { headers: biz })).arrayBuffer())
      const soft = await sharp(Buffer.from(png)).resize(300).blur(1.2).png().toBuffer()
      expect(await decode(new Uint8Array(soft))).toBe(URL_OF_PROFILE)
    }
  })

  it('keeps the center plate under what level H can restore', async () => {
    for (const size of sizes) {
      const l = qrLayout(URL_OF_PROFILE, { size, center: true })
      expect(l.ecc).toBe('H')
      expect(l.plateShare).toBeLessThanOrEqual(0.15)
    }
  })

  it('draws the logo with its own aspect ratio inside the plate (svg)', async () => {
    const { app } = setup()
    const svg = await (await app.request('/qr/alice.test.svg?center=logo&s=512', { headers: biz })).text()
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"')
    expect(svg).toContain('data:image/jpeg;base64,')
    const meta = await sharp(LOGO).metadata()
    expect(meta.width! / meta.height!).toBeCloseTo(1, 3)
  })

  it('uses a non-square logo without stretching it', async () => {
    const wide = new Uint8Array(await sharp({ create: { width: 400, height: 200, channels: 3, background: '#06c' } }).png().toBuffer())
    const { app, deps } = setup()
    deps.qrLogo = wide
    const png = new Uint8Array(await (await app.request('/qr/alice.test.png?center=logo&s=1024', { headers: biz })).arrayBuffer())
    expect(await decode(png)).toBe(URL_OF_PROFILE)
    // The plate is square. A 2:1 image fits the width, so the plate's top and bottom bands stay white.
    const l = qrLayout(URL_OF_PROFILE, { size: 1024, center: true })
    const px = (m: number) => Math.round(m * l.modulePx)
    const { data, info } = await sharp(Buffer.from(png)).raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => { const o = (y * info.width + x) * info.channels; return [data[o], data[o + 1], data[o + 2]] }
    const cx = px(l.plate!.x + l.plate!.size / 2)
    expect(at(cx, px(l.plate!.y + 1.3))).toEqual([255, 255, 255])
    expect(at(cx, px(l.plate!.y + l.plate!.size / 2))).not.toEqual([255, 255, 255])
  })

  it('uses the current avatar through the avatar rules and falls back to the default', async () => {
    const calls: string[] = []
    const avatar = await avatarPng()
    const blocked = setup({ avatar })
    blocked.deps.resolver.getBlob = async (_i, cid) => { calls.push(cid); return avatar }
    blocked.index.blocked.add(`${DID}/bafyreiabc123`)
    const png = new Uint8Array(await (await blocked.app.request('/qr/alice.test.png?center=avatar&s=800', { headers: biz })).arrayBuffer())
    expect(calls).toEqual([]) // a blocked image is never fetched
    expect(await decode(png)).toBe(URL_OF_PROFILE)

    const adult = setup({ candidates: [{ source: 'adapter:bluesky', did: DID, blob: { cid: 'bafyx', mimeType: 'image/png' }, rating: 'x' }], avatar })
    adult.deps.resolver.getBlob = async (_i, cid) => { calls.push(cid); return avatar }
    expect((await adult.app.request('/qr/alice.test.png?center=avatar&s=800', { headers: biz })).status).toBe(200)
    expect(calls).toEqual([]) // rating x is above the default rating g

    const ok = setup({ avatar })
    ok.deps.resolver.getBlob = async (_i, cid) => { calls.push(cid); return avatar }
    await ok.app.request('/qr/alice.test.png?center=avatar&s=800', { headers: biz })
    expect(calls).toEqual(['bafyreiabc123'])
  })

  it('falls back to the default avatar when the blob cannot be read', async () => {
    const { app, deps } = setup()
    deps.resolver.getBlob = async () => { throw new Error('pds down') }
    const res = await app.request('/qr/alice.test.png?center=avatar&s=800', { headers: biz })
    expect(res.status).toBe(200)
    expect(await decode(new Uint8Array(await res.arrayBuffer()))).toBe(URL_OF_PROFILE)
  })

  it('answers 400 for a bad center or quiet value and 404 for unknown profiles', async () => {
    const { app } = setup()
    for (const q of ['center=heart', 'quiet=3', 'quiet=17', 'quiet=x', 'quiet=']) {
      const res = await app.request(`/qr/alice.test.png?${q}`, { headers: biz })
      expect(res.status).toBe(400)
      expect((await res.json()).error.code).toBe('invalid_qr_option')
    }
    expect((await app.request('/qr/nobody.test.png?center=logo')).status).toBe(404)
  })

  it('works without a key and clamps to the free size cap', async () => {
    const { app } = setup()
    const res = await app.request('/qr/alice.test.png?s=2000&center=logo')
    expect(res.status).toBe(200)
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
    expect(meta.width!).toBeLessThanOrEqual(512)
  })

  it('raises a tiny size to the minimum module size', async () => {
    const { app } = setup()
    const png = new Uint8Array(await (await app.request('/qr/alice.test.png?s=20', { headers: biz })).arrayBuffer())
    const l = qrLayout(URL_OF_PROFILE, { size: 20 })
    expect(l.modulePx).toBe(4)
    expect((await sharp(Buffer.from(png)).metadata()).width).toBe(l.pixels)
    expect(await decode(png)).toBe(URL_OF_PROFILE)
  })
})
