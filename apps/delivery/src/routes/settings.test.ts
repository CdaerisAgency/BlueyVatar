import { describe, expect, it } from 'vitest'
import { emailHash } from '@blueyvatar/core'
import type { SiteSettings } from '@blueyvatar/core/settings'
import { DEFAULT_SETTINGS } from '@blueyvatar/core/settings'
import { createApp } from '../app.js'
import { UsageAlerts, MemoryAlertLedger, type UsageAlert } from '../alerts.js'
import { MemoryLicenseStore } from '../licenses.js'
import { pgSettingRows } from '../site-settings.js'
import { lic, setup } from '../test/harness.js'

/** A mutable settings object, as the cache would swap snapshots. */
function live(over: Partial<SiteSettings> = {}) {
  const box = { s: { ...DEFAULT_SETTINGS, ...over } as SiteSettings }
  return { box, source: { current: () => box.s } }
}

function app(over: Partial<SiteSettings> = {}) {
  const { deps, index } = setup()
  const l = live(over)
  deps.settings = l.source
  deps.licenses = new MemoryLicenseStore([lic('sk_free', 'secret', 'LF', 'free'), lic('sk_plus', 'secret', 'LP', 'plus')])
  return { app: createApp(deps), box: l.box, index, deps }
}

const HASH = emailHash('alice@example.com')
const anon = (n: number) => ({ 'cf-connecting-ip': `203.0.113.${n}` })

describe('delivery reads live settings', () => {
  it('anonymous limit comes from settings', async () => {
    const { app: a } = app({ anonymousDaily: 3 })
    const codes: number[] = []
    for (let i = 0; i < 4; i++) codes.push((await a.request(`/avatar/${HASH}?json=true`, { headers: anon(1) })).status)
    expect(codes.slice(0, 3)).not.toContain(429)
    expect(codes[3]).toBe(429)
  })

  it('a lowered limit applies on the next hit', async () => {
    const { app: a, box } = app({ anonymousDaily: 10 })
    for (let i = 0; i < 5; i++) expect((await a.request(`/avatar/${HASH}?json=true`, { headers: anon(2) })).status).not.toBe(429)
    box.s = { ...box.s, anonymousDaily: 3 }
    expect((await a.request(`/avatar/${HASH}?json=true`, { headers: anon(2) })).status).toBe(429)
  })

  it('max size comes from settings', async () => {
    const { app: a } = app({ maxSize: { free: 128, plus: 1024, business: 2048 } })
    const res = await a.request(`/avatar/${HASH}?s=512`, { headers: { 'x-api-key': 'sk_free' } })
    expect(res.status).toBe(302)
    expect(res.headers.get('x-adjusted-params')).toContain('s')
    expect(res.headers.get('location')).toMatch(/128/)
  })

  it('profile access follows settings', async () => {
    const cross = { origin: 'https://site.test' }
    const { app: a, box } = app()
    expect((await a.request('/profile/alice.test', { headers: cross })).status).toBe(403)
    expect((await a.request('/profile/alice.test', { headers: { ...cross, 'x-api-key': 'sk_free' } })).status).toBe(403)
    box.s = { ...box.s, profileAccess: { ...box.s.profileAccess, anonymous: true } }
    expect((await a.request('/profile/alice.test', { headers: cross })).status).toBe(200)
    box.s = { ...box.s, profileAccess: { ...box.s.profileAccess, anonymous: false, free: true } }
    expect((await a.request('/profile/alice.test', { headers: { ...cross, 'x-api-key': 'sk_free' } })).status).toBe(200)
  })

  it('403 message has no plan names', async () => {
    const { app: a } = app()
    const res = await a.request('/profile/alice.test', { headers: { origin: 'https://site.test' } })
    expect(res.status).toBe(403)
    expect((await res.json()).error.message).toBe('Cross-origin profile access depends on your plan. See https://blueyvatar.com/pricing')
  })

  it('/usage reports the live included volume', async () => {
    const { app: a } = app({ keyedMonthly: { plus: 123_456, business: DEFAULT_SETTINGS.keyedMonthly.business } })
    const res = await a.request('/usage', { headers: { 'x-api-key': 'sk_plus' } })
    expect(res.status).toBe(200)
    expect((await res.json()).included.volume).toBe(123_456)
  })

  it('alerts use the live included volume', async () => {
    const sent: UsageAlert[] = []
    const alerts = new UsageAlerts({ send: async (x) => { sent.push(x) } }, new MemoryAlertLedger(), () => new Date('2026-11-15T00:00:00Z'))
    const s = { ...DEFAULT_SETTINGS, keyedMonthly: { plus: 10, business: DEFAULT_SETTINGS.keyedMonthly.business } }
    await alerts.check('L1', 'plus', 7, s)
    expect(sent).toHaveLength(0)
    await alerts.check('L1', 'plus', 8, s)
    expect(sent.map((x) => x.threshold)).toEqual([80])
  })

  it('missing table serves defaults', async () => {
    const pool = { query: async () => { throw Object.assign(new Error('relation "site_settings" does not exist'), { code: '42P01' }) } }
    expect(await pgSettingRows(pool as never)()).toEqual([])
  })

  it('other query errors propagate', async () => {
    const pool = { query: async () => { throw Object.assign(new Error('boom'), { code: '08006' }) } }
    await expect(pgSettingRows(pool as never)()).rejects.toThrow('boom')
  })
})
