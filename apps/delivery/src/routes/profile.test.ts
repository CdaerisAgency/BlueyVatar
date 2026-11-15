import { describe, expect, it } from 'vitest'
import { GALLERY_MAX, imagePath, restrictedScope } from '@blueyvatar/core'
import { createApp } from '../app.js'
import { PUBLIC_VISIBILITY } from '../store.js'
import { DID, SECRET, setup } from '../test/harness.js'

describe('/profile', () => {
  it('allows cross-origin reads of profile JSON', async () => {
    const { app } = setup()
    const res = await app.request('/profile/alice.test', { headers: { origin: 'https://site.test', 'x-api-key': 'sk_biz' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  describe('profile hovercard gating', () => {
    const cross = { origin: 'https://site.test' }
    it('rejects anonymous cross-origin callers', async () => {
      const { app } = setup()
      const res = await app.request('/profile/alice.test', { headers: cross })
      expect(res.status).toBe(403)
      expect((await res.json()).error.code).toBe('tier_required')
    })
    it('allows cross-origin callers with a Plus key, and can fetch QR codes', async () => {
      const { app } = setup()
      const res = await app.request('/profile/alice.test', { headers: { ...cross, 'x-api-key': 'sk_test' } })
      expect(res.status).toBe(200)
      expect((await app.request('/qr/alice.test.png', { headers: { 'x-api-key': 'sk_test' } })).status).toBe(200)
    })
    it('treats a legacy pro license as Plus everywhere', async () => {
      const { app } = setup()
      const res = await app.request('/profile/alice.test', { headers: { ...cross, 'x-api-key': 'sk_legacy' } })
      expect(res.status).toBe(200)
      expect(res.headers.get('x-tier')).toBe('plus')
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

  it('returns backgroundColor in the profile JSON, null when unset or malformed', async () => {
    const { app, deps } = setup()
    expect((await (await app.request('/profile/alice.test')).json()).backgroundColor).toBeNull()
    const record = (own: Record<string, unknown>) => {
      const base = deps.resolver.getRecord
      deps.resolver.getRecord = async (i, collection, rkey) => (collection === 'com.blueyvatar.profile' ? own : base(i, collection, rkey))
    }
    record({ backgroundColor: '#1F4E9B' })
    expect((await (await app.request('/profile/alice.test')).json()).backgroundColor).toBe('#1f4e9b')
    for (const bad of ['red', '#fff', 'url(javascript:1)', 7]) {
      record({ backgroundColor: bad })
      expect((await (await app.request('/profile/alice.test')).json()).backgroundColor).toBeNull()
    }
  })

  it('returns languages, social links, and only the wallets the owner chose to show', async () => {
    const { app, deps } = setup()
    const empty = await (await app.request('/profile/alice.test')).json()
    expect(empty).toMatchObject({ languages: [], socialLinks: [], wallets: [] })
    const base = deps.resolver.getRecord
    deps.resolver.getRecord = async (i, collection, rkey) =>
      collection === 'com.blueyvatar.profile'
        ? {
            languages: [{ tag: 'pt-br', primary: true }, { tag: 'en' }, { tag: 'not a tag' }],
            socialLinks: [{ label: 'Blog', url: 'https://blog.example/' }, { url: 'http://insecure.example/' }],
            wallets: [
              { chain: 'Bitcoin', address: 'bc1qshown', visible: true },
              { chain: 'Ethereum', address: '0xhidden', visible: false },
              { chain: 'Solana', address: 'defaultsHidden' },
            ],
          }
        : base(i, collection, rkey)
    const body = await (await app.request('/profile/alice.test')).json()
    expect(body.languages).toEqual([{ tag: 'pt-BR', primary: true }, { tag: 'en', primary: false }])
    expect(body.socialLinks).toEqual([{ label: 'Blog', url: 'https://blog.example/' }])
    expect(body.wallets).toEqual([{ chain: 'Bitcoin', address: 'bc1qshown', label: null, verified: false }])
    expect(JSON.stringify(body)).not.toContain('0xhidden')
    expect(JSON.stringify(body)).not.toContain('defaultsHidden')
  })

  it('lists detected atproto apps in the profile JSON', async () => {
    const { app } = setup()
    const body = await (await app.request('/profile/alice.test')).json()
    expect(body.atprotoApps).toEqual([{ id: 'tangled', name: 'Tangled', url: 'https://tangled.org' }])
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

  it('returns the gallery for a DID with a Plus subscription, with no PLUS_DIDS entry', async () => {
    const { deps, index } = setup()
    deps.resolver = { ...deps.resolver, galleryItems: async () => items(2) }
    deps.plusDids = undefined
    const app = createApp(deps)
    expect(await gal(app)).toEqual([])
    index.plusSubscribers.add(DID)
    expect(await gal(app)).toHaveLength(2)
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
