import { describe, expect, it } from 'vitest'
import { emailHash } from '@blueyvatar/core'
import { createApp } from '../app.js'
import { PUBLIC_VISIBILITY } from '../store.js'
import { DID, img, setup, setupDeps } from '../test/harness.js'

describe('security and errors', () => {
  it('sends retry-after on 429 and no x-cache-status on /img', async () => {
    const { app } = setup()
    const h = emailHash('alice@example.com')
    let res: Response | undefined
    for (let i = 0; i < 101; i++) res = await app.request(`/avatar/${h}?json=true`, { headers: { 'cf-connecting-ip': '203.0.113.88' } })
    expect(res!.status).toBe(429)
    const wait = Number(res!.headers.get('retry-after'))
    expect(wait).toBeGreaterThanOrEqual(1)
    expect(wait).toBeLessThanOrEqual(86_400)
    expect((await app.request(`/avatar/${h}`, { headers: { 'cf-connecting-ip': '203.0.113.89' } })).headers.get('retry-after')).toBeNull()
    expect((await app.request(img(80))).headers.get('x-cache-status')).toBeNull()
  })

  it('returns the standard JSON error for unhandled faults', async () => {
    const { app, deps } = setup()
    deps.resolver.resolveIdentity = async () => { throw new Error('boom') }
    const res = await app.request('/u/alice.test')
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('internal')
  })

  it('honors keyed-only visibility and hidden profiles', async () => {
    const { app, index } = setup()
    index.rules.set(DID, { ...PUBLIC_VISIBILITY, keyedOnly: true, hiddenProfile: true })
    expect((await app.request('/u/alice.test?d=404')).status).toBe(404)
    expect((await app.request('/u/alice.test', { headers: { 'x-api-key': 'sk_test' } })).status).toBe(302)
    expect((await app.request('/profile/alice.test')).status).toBe(404)
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

  describe('hash enumeration (issue 59)', () => {
    const summarize = (r: Response) => ({
      status: r.status,
      location: r.headers.get('location'),
      cacheControl: r.headers.get('cache-control'),
      contentType: r.headers.get('content-type'),
    })

    it('answers unlinked, opted-out, and restricted hashes identically', async () => {
      const { app, index } = setup()
      const unlinked = emailHash('nobody@example.com')
      const optedOut = emailHash('optout@example.com')
      const restricted = emailHash('restricted@example.com')
      const inactive = emailHash('gone@example.com')
      index.emails.set(optedOut, 'did:plc:optout')
      index.rules.set('did:plc:optout', { ...PUBLIC_VISIBILITY, emailLookupOptOut: true })
      index.emails.set(restricted, 'did:plc:restricted')
      index.rules.set('did:plc:restricted', { ...PUBLIC_VISIBILITY, keyedOnly: true })
      index.emails.set(inactive, 'did:plc:gone')
      index.inactive.add('did:plc:gone')

      for (const query of ['', '?d=identicon', '?d=404']) {
        const results = []
        for (const h of [unlinked, optedOut, restricted, inactive]) {
          const res = await app.request(`/avatar/${h}${query}`)
          const { location, ...rest } = summarize(res)
          // The seed is the requested hash, so only the seed may differ in the redirect target.
          results.push({ ...rest, location: location?.replace(h, 'HASH') ?? null, body: await res.text() })
        }
        for (const r of results.slice(1)) expect(r).toEqual(results[0])
      }
    })

    it('does not resolve identities for hashes the caller may not see', async () => {
      const { deps, index } = setup()
      const restricted = emailHash('restricted@example.com')
      index.emails.set(restricted, 'did:plc:restricted')
      index.rules.set('did:plc:restricted', { ...PUBLIC_VISIBILITY, domainAllowlist: ['only.example'] })
      let resolved = 0
      const app = createApp({ ...deps, resolver: { ...deps.resolver, resolveIdentity: async (i) => { resolved++; return deps.resolver.resolveIdentity(i) } } })
      await app.request(`/avatar/${restricted}`)
      expect(resolved).toBe(0)
    })

    it('still serves a restricted avatar to a caller that passes the rule', async () => {
      const { app, index } = setup()
      index.rules.set(DID, { ...PUBLIC_VISIBILITY, keyedOnly: true })
      const h = emailHash('alice@example.com')
      expect((await app.request(`/avatar/${h}`)).headers.get('location')).toMatch(/^\/default\//)
      const ok = await app.request(`/avatar/${h}`, { headers: { 'x-api-key': 'sk_test' } })
      expect(ok.headers.get('location')).toMatch(/^\/img\//)
    })

    it('profile and QR lookups by hash return 404 for restricted, like unlinked', async () => {
      const { app, index } = setup()
      index.rules.set(DID, { ...PUBLIC_VISIBILITY, keyedOnly: true })
      const restricted = await app.request(`/profile/${emailHash('alice@example.com')}`)
      const unlinked = await app.request(`/profile/${emailHash('nobody@example.com')}`)
      expect(restricted.status).toBe(404)
      expect(await restricted.json()).toEqual(await unlinked.json())
    })
  })
})
