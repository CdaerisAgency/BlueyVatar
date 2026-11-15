import { describe, expect, it } from 'vitest'
import { img, raw, setup } from '../test/harness.js'

describe('avatar parameters', () => {
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

    it.each([
      ['fmt=avif', 'invalid_format'],
      ['fmt=webp&q=0', 'invalid_quality'],
      ['fmt=webp&q=101', 'invalid_quality'],
    ])('rejects %s with %s on a keyed request', async (qs, code) => {
      const { app } = setup()
      expect((await (await app.request(`/u/alice.test?${qs}`, { headers: { 'x-api-key': 'sk_test' } })).json()).error.code).toBe(code)
    })

    it.each([
      ['q=abc', 'invalid_quality'],
      ['fmt=gif', 'invalid_format'],
      ['fmt=WEBP', 'invalid_format'],
      ['fmt=PNG', 'invalid_format'],
    ])('rejects %s with %s, keyed or anonymous', async (qs, code) => {
      const { app } = setup()
      for (const headers of [{ 'x-api-key': 'sk_test' }, {}] as Record<string, string>[]) {
        const res = await app.request(`/u/alice.test?${qs}`, { headers })
        expect(res.status).toBe(400)
        expect((await res.json()).error.code).toBe(code)
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

    it.each(['30m', '29d', '0h', '3600', '1w'])('rejects ttl=%s as outside the range or without a unit', async (bad) => {
      const { app } = setup()
      const res = await app.request(`/u/alice.test?ttl=${bad}`, { headers: { 'x-api-key': 'sk_test' } })
      expect(res.status).toBe(400)
      expect((await res.json()).error.code).toBe('invalid_ttl')
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
})
