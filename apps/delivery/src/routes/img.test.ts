import { BlobError } from '../blob.js'
import { describe, expect, it } from 'vitest'
import { imagePath } from '@blueyvatar/core'
import { createApp } from '../app.js'
import { PUBLIC_VISIBILITY } from '../store.js'
import { ResizeBusyError } from '../resize.js'
import { CID, DAY, DID, img, raw, setup } from '../test/harness.js'

describe('/img and image serving', () => {
  it('maps a missing blob to 404 and other blob failures to 502 on /img', async () => {
    const { app, deps } = setup()
    deps.resolver.getBlob = async () => { throw new BlobError('not_found', 'x', 404) }
    const missing = await app.request(img(80))
    expect(missing.status).toBe(404)
    expect((await missing.json()).error.code).toBe('not_found')
    deps.resolver.getBlob = async () => { throw new BlobError('upstream', 'x') }
    expect((await app.request(img(80))).status).toBe(502)
    deps.resolver.getBlob = async () => { throw new BlobError('invalid_endpoint', 'x') }
    expect((await app.request(img(80))).status).toBe(502)
  })

  it('answers 404 for a blocked image on /img and skips it in redirects', async () => {
    const { app, index } = setup()
    index.blocked.add(`${DID}/bafyreiabc123`)
    expect((await app.request(img(80))).status).toBe(404)
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

  describe('crop parameters (issue #203)', () => {
    it('hands the crop saved on the record to the resizer, and none when the record has no crop', async () => {
      const { deps, index } = setup()
      const jobs: Array<{ crop?: unknown }> = []
      const app = createApp({ ...deps, resize: async (job) => { jobs.push(job); return new Uint8Array([9]) } })
      await app.request(img(128))
      expect(jobs.at(-1)).not.toHaveProperty('crop')
      index.images.set(DID, [{ rkey: 'r1', cid: 'bafyreiabc123', mimeType: 'image/jpeg', rating: 'g', isDefault: true, createdAt: '2026-01-01T00:00:00Z', crop: { x: 1000, y: 2000, size: 6000 } }])
      await app.request(img(256))
      expect(jobs.at(-1)).toMatchObject({ crop: { x: 1000, y: 2000, size: 6000 } })
    })
  })

  describe('resize capacity (issue #198)', () => {
    it('answers 503 with Retry-After and no-store when the resize queue is full, and meters nothing', async () => {
      const { deps, usage } = setup()
      const app = createApp({ ...deps, resize: async () => { throw new ResizeBusyError(4) } })
      const res = await app.request(img(128))
      expect(res.status).toBe(503)
      expect(res.headers.get('retry-after')).toBe('4')
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect((await res.json()).error.code).toBe('overloaded')
      expect(usage.service.size).toBe(0)
    })

    it('sheds default avatars the same way', async () => {
      const { deps } = setup()
      const app = createApp({ ...deps, resize: async () => { throw new ResizeBusyError(2) } })
      const res = await app.request('/default/mp/128.png?seed=x')
      expect(res.status).toBe(503)
      expect(res.headers.get('retry-after')).toBe('2')
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
})
