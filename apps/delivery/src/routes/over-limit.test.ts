import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { Metrics, emailHash } from '@blueyvatar/core'
import { DEFAULT_SETTINGS, type SiteSettings } from '@blueyvatar/core/settings'
import { createApp } from '../app.js'
import { MemoryLicenseStore } from '../licenses.js'
import { pgOverLimitAsset } from '../over-limit-asset.js'
import { lic, setup } from '../test/harness.js'

const HASH = emailHash('alice@example.com')
const hdr = { 'cf-connecting-ip': '203.0.113.50' }

async function png(size: number) {
  return sharp({ create: { width: size, height: size, channels: 4, background: '#3366cc' } }).png().toBuffer()
}

async function realResize(job: { input: Uint8Array; size: number; format: 'png' | 'jpeg' | 'webp' }) {
  return new Uint8Array(await sharp(job.input).resize(job.size, job.size).toFormat(job.format).toBuffer())
}

function overLimitApp(over: Partial<SiteSettings> = {}, asset: Buffer | null = null, sha = 'x') {
  const { deps } = setup()
  deps.licenses = new MemoryLicenseStore([lic('sk_free', 'secret', 'LF', 'free'), lic('sk_old', 'secret', 'LO', 'plus', { expiresAt: new Date(Date.now() - 1000) })])
  deps.settings = { current: () => ({ ...DEFAULT_SETTINGS, anonymousDaily: 1, ...over }) }
  deps.resize = realResize
  deps.overLimitAsset = { get: async () => (asset ? { bytes: asset, mime: 'image/png', sha256: sha } : null) }
  return createApp(deps)
}

async function second(app: ReturnType<typeof createApp>, query: string) {
  await app.request(`/avatar/${HASH}${query}`, { headers: hdr })
  return app.request(`/avatar/${HASH}${query}`, { headers: hdr })
}

describe('over-limit', () => {
  it('over-limit image request redirects to the over-limit avatar', async () => {
    const res = await second(overLimitApp(), '?s=200')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/default/over-limit/200.png')
    expect(res.headers.get('cache-control')).toBe('private, max-age=300')
    expect(res.headers.get('x-over-limit')).toBe('1')
    expect(res.headers.get('retry-after')).toBeTruthy()
  })

  it('clamps the size to the free max size setting', async () => {
    const res = await overLimitApp({ maxSize: { free: 128, plus: 1024, business: 2048 } }, await png(512)).request('/default/over-limit/1000.png')
    expect(res.status).toBe(200)
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(128)
  })

  it('json over limit stays 429', async () => {
    const res = await second(overLimitApp(), '?s=200&json=true')
    expect(res.status).toBe(429)
    expect(res.headers.get('content-type')).toContain('json')
  })

  it('over limit with d=404 returns 404 on /avatar, like an ordinary miss', async () => {
    const normal = await overLimitApp({ anonymousDaily: 100 }).request(`/avatar/${emailHash('nobody@example.com')}?d=404`, { headers: hdr })
    expect(normal.status).toBe(404)
    const res = await second(overLimitApp(), '?s=200&d=404')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual(await normal.json())
    expect(res.headers.get('content-type')).toBe(normal.headers.get('content-type'))
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('cache-control')).toBe('private, max-age=300')
    expect(res.headers.get('x-over-limit')).toBe('1')
    expect(res.headers.get('retry-after')).toBeTruthy()
    expect((await second(overLimitApp(), '?default=404')).status).toBe(404)
  })

  it('over limit with d=404 returns 404 on /u/<handle>', async () => {
    const app = overLimitApp()
    await app.request('/u/alice.test?d=404', { headers: hdr })
    const res = await app.request('/u/alice.test?d=404', { headers: hdr })
    expect(res.status).toBe(404)
    expect(res.headers.get('x-over-limit')).toBe('1')
    expect(res.headers.get('retry-after')).toBeTruthy()
    const normal = await overLimitApp({ anonymousDaily: 100 }).request('/u/nobody.test?d=404', { headers: hdr })
    expect(normal.status).toBe(404)
    expect(await res.text()).toBe(await normal.text())
    expect(res.headers.get('content-type')).toBe(normal.headers.get('content-type'))
  })

  it('json over limit with d=404 still returns 429 JSON', async () => {
    const res = await second(overLimitApp(), '?s=200&json=true&d=404')
    expect(res.status).toBe(429)
    expect(res.headers.get('content-type')).toContain('json')
    expect(res.headers.get('location')).toBeNull()
  })

  it('over limit ignores d styles and URLs', async () => {
    for (const d of ['identicon', 'https://allowed.example/x.png']) {
      const res = await second(overLimitApp(), `?s=200&d=${encodeURIComponent(d)}`)
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/default/over-limit/200.png')
    }
  })

  it('format kept when the plan allows it, else png', async () => {
    const res = await second(overLimitApp(), '?s=200&fmt=webp')
    expect(res.headers.get('location')).toBe('/default/over-limit/200.png')
  })

  it('size snapped to the free max', async () => {
    const res = await second(overLimitApp(), '?s=2000')
    expect(res.headers.get('location')).toBe('/default/over-limit/512.png')
  })

  it('serves the uploaded asset', async () => {
    const app = overLimitApp({}, await png(300))
    const res = await app.request('/default/over-limit/64.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
    expect([meta.width, meta.height]).toEqual([64, 64])
  })

  it('serves the silhouette with no upload', async () => {
    const app = overLimitApp()
    const res = await app.request('/default/over-limit/64.png')
    expect(res.status).toBe(200)
    const ref = await app.request('/default/mp/64.png?seed=over-limit')
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(await ref.arrayBuffer()))).toBe(true)
  })

  it('rejects bad file names', async () => {
    const res = await overLimitApp().request('/default/over-limit/abc.gif')
    expect(res.status).toBe(400)
  })
})

describe('over-limit scope', () => {
  it('unknown and expired keys stay 401 on image requests', async () => {
    const app = overLimitApp()
    expect((await app.request(`/avatar/${HASH}`, { headers: { ...hdr, 'x-api-key': 'sk_nope' } })).status).toBe(401)
    expect((await app.request(`/avatar/${HASH}`, { headers: { ...hdr, 'x-api-key': 'sk_old' } })).status).toBe(401)
  })

  it('a keyed blocked-volume request redirects, png when the format is not allowed', async () => {
    const app = overLimitApp({ keyedDaily: { free: 1 } })
    const h = { 'x-api-key': 'sk_free' }
    await app.request(`/avatar/${HASH}?fmt=webp`, { headers: h })
    const res = await app.request(`/avatar/${HASH}?fmt=webp&s=100`, { headers: h })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/default/over-limit/100.png')
    expect(res.headers.get('x-over-limit')).toBe('1')
  })

  it('/u/<handle> over limit redirects', async () => {
    const app = overLimitApp()
    await app.request('/u/alice.test', { headers: hdr })
    const res = await app.request('/u/alice.test?s=50', { headers: hdr })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/default/over-limit/50.png')
  })

  it('counts the rate limit rejection on the redirect path', async () => {
    const { deps } = setup()
    deps.settings = { current: () => ({ ...DEFAULT_SETTINGS, anonymousDaily: 1 }) }
    deps.metrics = new Metrics()
    const app = createApp(deps)
    await second(app, '')
    expect(deps.metrics.counter('delivery_rate_limit_rejections_total')).toBe(1)
  })
})

describe('over-limit URL versioning', () => {
  const SHA = 'abcdef0123456789'
  it('redirect carries v with the first 8 chars of the asset sha', async () => {
    const res = await second(overLimitApp({}, await png(10), SHA), '?s=64')
    expect(res.headers.get('location')).toBe('/default/over-limit/64.png?v=abcdef01')
    expect(res.headers.get('cache-control')).toBe('private, max-age=300')
  })

  it('silhouette redirect has no v', async () => {
    const res = await second(overLimitApp(), '?s=64')
    expect(res.headers.get('location')).toBe('/default/over-limit/64.png')
  })

  it('the route ignores v and serves the current asset', async () => {
    const res = await overLimitApp({}, await png(300), SHA).request('/default/over-limit/32.png?v=deadbeef')
    expect(res.status).toBe(200)
  })

  it('a changed asset gives a new v after the TTL', async () => {
    let now = 1_000_000
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      let row = { image: Buffer.from('a'), mime: 'image/png', sha256: '11111111aaaa' }
      let queries = 0
      const pool = { query: async () => { queries++; return { rows: [row] } } } as never
      const store = pgOverLimitAsset(pool, 60_000)
      expect((await store.get())?.sha256).toBe('11111111aaaa')
      row = { ...row, sha256: '22222222bbbb' }
      now += 30_000
      expect((await store.get())?.sha256).toBe('11111111aaaa')
      expect(queries).toBe(1)
      now += 31_000
      expect((await store.get())?.sha256).toBe('22222222bbbb')
      expect(queries).toBe(2)
    } finally { spy.mockRestore() }
  })

  it('a database error is cached briefly and the last good value is kept', async () => {
    let now = 1_000_000
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      let fail = false
      let queries = 0
      const pool = { query: async () => { queries++; if (fail) throw new Error('down'); return { rows: [{ image: Buffer.from('a'), mime: 'image/png', sha256: '33333333cccc' }] } } } as never
      const store = pgOverLimitAsset(pool, 60_000)
      await store.get()
      fail = true
      now += 61_000
      expect((await store.get())?.sha256).toBe('33333333cccc')
      expect(queries).toBe(2)
      await store.get()
      expect(queries).toBe(2)
      now += 11_000
      await store.get()
      expect(queries).toBe(3)
    } finally { spy.mockRestore() }
  })
})
