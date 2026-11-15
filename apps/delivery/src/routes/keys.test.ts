import { describe, expect, it } from 'vitest'
import { emailHash } from '@blueyvatar/core'
import { keyExpired } from '../licenses.js'
import { img, setup } from '../test/harness.js'

describe('keys and rate limits', () => {
  it('applies tier entitlements and meters keyed requests', async () => {
    const { app, usage } = setup()
    const res = await app.request('/u/did:plc:abc123?fmt=webp&q=70', { headers: { 'x-api-key': 'sk_test' } })
    expect(res.headers.get('location')).toBe(img(80, 'webp', 70))
    expect(res.headers.get('x-tier')).toBe('plus')
    expect(usage.counts.get('L1:origin_resolution')).toBe(1)
  })

  it('checks publishable key domains and license status', async () => {
    const { app } = setup()
    expect((await app.request('/u/alice.test?token=pk_test', { headers: { origin: 'https://evil.test' } })).status).toBe(403)
    expect((await app.request('/u/alice.test?token=pk_test', { headers: { origin: 'https://app.example.com' } })).status).toBe(302)
    expect((await app.request('/u/alice.test?token=sk_test')).status).toBe(401)
    expect((await app.request('/u/alice.test', { headers: { 'x-api-key': 'sk_dead' } })).status).toBe(402)
  })

  it('enforces the anonymous daily limit per client IP', async () => {
    const { app } = setup()
    let last = 0
    for (let i = 0; i < 101; i++) last = (await app.request('/u/alice.test', { headers: { 'cf-connecting-ip': '203.0.113.9' } })).status
    expect(last).toBe(429)
    expect((await app.request('/u/alice.test', { headers: { 'cf-connecting-ip': '203.0.113.10' } })).status).toBe(302)
  })
})

describe('key expiry', () => {
  const avatar = `/avatar/${emailHash('alice@example.com')}?s=64`
  it('rejects an expired publishable key with 401 key_expired', async () => {
    const { app } = setup()
    const res = await app.request(`${avatar}&token=pk_old`)
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('key_expired')
  })
  it('rejects an expired secret key on the header and on /usage', async () => {
    const { app } = setup()
    const a = await app.request(avatar, { headers: { 'x-api-key': 'sk_old' } })
    expect(a.status).toBe(401)
    expect((await a.json()).error.code).toBe('key_expired')
    const u = await app.request('/usage', { headers: { 'x-api-key': 'sk_old' } })
    expect(u.status).toBe(401)
    expect((await u.json()).error.code).toBe('key_expired')
  })
  it('still serves a key that has not expired yet, and keys with no expiry', async () => {
    const { app } = setup()
    expect((await app.request(`${avatar}&token=pk_future`, { redirect: 'manual' })).status).toBeLessThan(400)
    expect((await app.request(avatar, { headers: { 'x-api-key': 'sk_test' }, redirect: 'manual' })).status).toBeLessThan(400)
  })
  it('keyExpired treats the expiry instant as expired', () => {
    const t = new Date('2026-11-08T00:00:00Z')
    expect(keyExpired(null, t)).toBe(false)
    expect(keyExpired(undefined, t)).toBe(false)
    expect(keyExpired(new Date(t.getTime() + 1), t)).toBe(false)
    expect(keyExpired(t, t)).toBe(true)
    expect(keyExpired(new Date(t.getTime() - 1), t)).toBe(true)
  })
})
