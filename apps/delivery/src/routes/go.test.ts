import { describe, expect, it } from 'vitest'
import { PUBLIC_VISIBILITY } from '../store.js'
import { DID, setup } from '../test/harness.js'

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

  it('answers a hidden verifiedAccounts section like an unknown platform (issue #291)', async () => {
    const { app, index, deps } = setup()
    index.accounts.set(DID, [acct('github', 'https://github.com/alice')])
    const base = deps.resolver.getRecord
    deps.resolver = { ...deps.resolver, getRecord: async (i, c, r) => (c === 'com.blueyvatar.profile' ? { hiddenSections: ['verifiedAccounts'] } : base(i, c, r)) }
    const hidden = await app.request('/go/alice.test/github')
    const unknown = await app.request('/go/alice.test/mastodon')
    expect(hidden.status).toBe(unknown.status)
    expect(hidden.headers.get('location')).toBe('https://bv.test/p/alice.test')
    expect(hidden.headers.get('location')).toBe(unknown.headers.get('location'))
    expect(hidden.headers.get('cache-control')).toBe(unknown.headers.get('cache-control'))
  })

  it('treats accounts as hidden when the profile record cannot be read', async () => {
    const { app, index, deps } = setup()
    index.accounts.set(DID, [acct('github', 'https://github.com/alice')])
    const base = deps.resolver.getRecord
    deps.resolver = { ...deps.resolver, getRecord: async (i, c, r) => { if (c === 'com.blueyvatar.profile') throw new Error('pds down'); return base(i, c, r) } }
    expect((await app.request('/go/alice.test/github')).headers.get('location')).toBe('https://bv.test/p/alice.test')
  })

  it('returns 404 for unknown handles and hidden profiles alike', async () => {
    const { app, index } = setup()
    expect((await app.request('/go/nobody.test/github')).status).toBe(404)
    index.rules.set(DID, { ...PUBLIC_VISIBILITY, hiddenProfile: true })
    expect((await app.request('/go/alice.test/github')).status).toBe(404)
  })
})
