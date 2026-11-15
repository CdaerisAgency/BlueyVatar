import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { MemoryLicenseStore } from '../licenses.js'
import { DID, setup } from '../test/harness.js'

describe('GET /usage', () => {
  it('rejects anonymous callers and publishable keys with stable codes', async () => {
    const { app } = setup()
    const anon = await app.request('/usage')
    expect(anon.status).toBe(401)
    expect((await anon.json()).error.code).toBe('invalid_key')
    const viaToken = await app.request('/usage?token=pk_test', { headers: { origin: 'https://app.example.com' } })
    expect(viaToken.status).toBe(401)
    expect((await viaToken.json()).error.code).toBe('invalid_key')
    const pub = await app.request('/usage', { headers: { 'x-api-key': 'pk_test' } })
    expect(pub.status).toBe(403)
    expect((await pub.json()).error.code).toBe('secret_key_required')
    expect((await app.request('/usage', { headers: { 'x-api-key': 'sk_nope' } })).status).toBe(401)
    expect((await app.request('/usage', { headers: { 'x-api-key': 'sk_dead' } })).status).toBe(402)
  })

  it('reports the current period, included volume, and per-meter counts for a Plus key', async () => {
    const { app } = setup()
    for (let i = 0; i < 3; i++) await app.request('/u/alice.test', { headers: { 'x-api-key': 'sk_test' } })
    await app.request('/profile/did:plc:abc123', { headers: { 'x-api-key': 'sk_test' } })
    const res = await app.request('/usage', { headers: { 'x-api-key': 'sk_test' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-tier')).toBe('plus')
    expect(res.headers.get('x-rate-limit-limit')).toBe('50000')
    const body = await res.json()
    const now = new Date()
    const period = `${now.toISOString().slice(0, 7)}-01`
    expect(body.tier).toBe('plus')
    expect(body.period.start).toBe(period)
    expect(body.included).toEqual({ volume: 50_000, per: 'month' })
    expect(body.total).toBe(3)
    expect(body.meters).toEqual({ origin_resolution: 3, profile_json: 1, transform: 0 })
    expect(body.history.months).toHaveLength(2)
    expect(body.history.months[0]).toEqual({ period, origin_resolution: 3, profile_json: 1, transform: 0 })
    expect(body.history.days).toHaveLength(30)
    expect(body.history.days[0]).toEqual({ date: now.toISOString().slice(0, 10), origin_resolution: 3, profile_json: 1 })
  })

  it('gives Business 12 months and Plus 30 days of history', async () => {
    const { app } = setup()
    const biz = await (await app.request('/usage', { headers: { 'x-api-key': 'sk_biz' } })).json()
    expect(biz.history.months).toHaveLength(12)
    expect(biz.history.days).toHaveLength(30)
    expect(biz.included).toEqual({ volume: 1_000_000, per: 'month' })
    const pro = await (await app.request('/usage', { headers: { 'x-api-key': 'sk_test' } })).json()
    expect(pro.history.months).toHaveLength(2)
  })

  it('shows the current period only for Free', async () => {
    const { deps } = setup()
    deps.licenses = new MemoryLicenseStore([
      { key: { key: 'sk_free', kind: 'secret', licenseId: 'LF', domains: [] }, license: { licenseId: 'LF', owner: DID, tier: 'free', status: 'active' } },
    ])
    const body = await (await createApp(deps).request('/usage', { headers: { 'x-api-key': 'sk_free' } })).json()
    expect(body.tier).toBe('free')
    expect(body.included).toEqual({ volume: 1_000, per: 'day' })
    expect(body.history).toEqual({ months: [], days: [] })
  })

  it('does not meter itself and sends no x-usage-cost', async () => {
    const { app, usage } = setup()
    const res = await app.request('/usage', { headers: { 'x-api-key': 'sk_test' } })
    expect(res.headers.get('x-usage-cost')).toBeNull()
    await app.request('/usage', { headers: { 'x-api-key': 'sk_test' } })
    expect(usage.counts.size).toBe(0)
    expect(usage.byPeriod.size).toBe(0)
    expect(usage.byDay.size).toBe(0)
  })

  it('applies the rate limit', async () => {
    const { deps } = setup()
    deps.licenses = new MemoryLicenseStore([
      { key: { key: 'sk_free', kind: 'secret', licenseId: 'LF', domains: [] }, license: { licenseId: 'LF', owner: DID, tier: 'free', status: 'active' } },
    ])
    deps.limiter = { hit: async () => ({ limit: 1000, remaining: 0, reset: Math.floor(Date.now() / 1000) + 60, exceeded: true }) }
    const res = await createApp(deps).request('/usage', { headers: { 'x-api-key': 'sk_free' } })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('rate_limited')
    expect(res.headers.get('retry-after')).not.toBeNull()
  })
})

describe('usage metering', () => {
  it('counts keyed profile JSON calls per DID per UTC day and nothing else', async () => {
    const { app, usage } = setup()
    expect((await app.request('/profile/alice.test', { headers: { 'x-api-key': 'sk_biz' } })).status).toBe(200)
    expect((await app.request('/profile/alice.test', { headers: { 'x-api-key': 'sk_biz' } })).status).toBe(200)
    expect((await app.request('/profile/alice.test')).status).toBe(200)
    expect((await app.request('/profile/nobody.test', { headers: { 'x-api-key': 'sk_biz' } })).status).toBe(404)
    expect([...usage.profileCalls.values()]).toEqual([2])
    expect([...usage.profileCalls.keys()][0]).toMatch(/^did:plc:[^:]+:\d{4}-\d{2}-\d{2}$/)
  })

  it('sends a usage alert when a keyed request reaches 80 percent', async () => {
    const { app, usage, sent } = setup()
    usage.counts.set('L1:origin_resolution', 39_999)
    await app.request('/u/alice.test', { headers: { 'x-api-key': 'sk_test' } })
    await app.request('/u/alice.test', { headers: { 'x-api-key': 'sk_test' } })
    expect(sent.map((a) => a.threshold)).toEqual([80])
  })
})
