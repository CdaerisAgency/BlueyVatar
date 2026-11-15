import { describe, expect, it } from 'vitest'
import { emailHash, qrSvg } from '@blueyvatar/core'
import { PUBLIC_VISIBILITY } from '../store.js'
import { DID, setup } from '../test/harness.js'

describe('/qr', () => {
  describe('QR code (F23)', () => {
    const biz = { 'x-api-key': 'sk_biz' }

    it('is available to everyone, with or without a key', async () => {
      const { app } = setup()
      expect((await app.request('/qr/alice.test.svg')).status).toBe(200)
      expect((await app.request('/qr/alice.test.svg', { headers: { 'x-api-key': 'sk_test' } })).status).toBe(200)
      expect((await app.request('/qr/alice.test.png')).status).toBe(200)
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
