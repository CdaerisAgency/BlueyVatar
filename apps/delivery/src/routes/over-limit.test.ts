import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { emailHash } from '@blueyvatar/core'
import { DEFAULT_SETTINGS, type SiteSettings } from '@blueyvatar/core/settings'
import { createApp } from '../app.js'
import { setup } from '../test/harness.js'

const HASH = emailHash('alice@example.com')
const hdr = { 'cf-connecting-ip': '203.0.113.50' }

async function png(size: number) {
  return sharp({ create: { width: size, height: size, channels: 4, background: '#3366cc' } }).png().toBuffer()
}

async function realResize(job: { input: Uint8Array; size: number; format: 'png' | 'jpeg' | 'webp' }) {
  return new Uint8Array(await sharp(job.input).resize(job.size, job.size).toFormat(job.format).toBuffer())
}

function overLimitApp(over: Partial<SiteSettings> = {}, asset: Buffer | null = null) {
  const { deps } = setup()
  deps.settings = { current: () => ({ ...DEFAULT_SETTINGS, anonymousDaily: 1, ...over }) }
  deps.resize = realResize
  deps.overLimitAsset = { get: async () => (asset ? { bytes: asset, mime: 'image/png', sha256: 'x' } : null) }
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

  it('json over limit stays 429', async () => {
    const res = await second(overLimitApp(), '?s=200&json=true')
    expect(res.status).toBe(429)
    expect(res.headers.get('content-type')).toContain('json')
  })

  it('over limit ignores d and redirects to the over-limit avatar', async () => {
    for (const d of ['404', 'https://allowed.example/x.png']) {
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
