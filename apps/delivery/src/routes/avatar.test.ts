import { describe, expect, it } from 'vitest'
import { emailHash, emailMd5 } from '@blueyvatar/core'
import { PUBLIC_VISIBILITY } from '../store.js'
import { CID, DID, img, setup } from '../test/harness.js'

describe('avatar routes', () => {
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

  it.each(['a'.repeat(31), 'a'.repeat(33), 'a'.repeat(40), 'a'.repeat(63), 'a'.repeat(65), 'z'.repeat(32), 'alice@example.com'])(
    'rejects %s as neither a 32 nor a 64 character hex hash',
    async (bad) => {
      const { app } = setup()
      const res = await app.request(`/avatar/${bad}`)
      expect(res.status).toBe(400)
      expect((await res.json()).error.code).toBe('invalid_identifier')
    },
  )

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
    for (let i = 0; i < 101; i++) last = (await app.request(`/avatar/${md5}?json=true`, { headers: { 'cf-connecting-ip': '203.0.113.77' } })).status
    expect(last).toBe(429)
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

  it('stops serving inactive repos', async () => {
    const { app, index } = setup()
    index.inactive.add(DID)
    expect((await app.request('/u/alice.test?d=404')).status).toBe(404)
    expect((await app.request(img(80))).status).toBe(404)
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
})
