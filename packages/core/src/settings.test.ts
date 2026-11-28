import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SETTING_DEFS, parseSettings, validateSetting, type SiteSettings } from './settings.js'
import { ENTITLEMENTS, entitlementsFor } from './tiers.js'
import { includedVolume } from './usage-window.js'
import { parseAvatarParams } from './params.js'

const withSettings = (patch: (s: SiteSettings) => void): SiteSettings => {
  const s = structuredClone(DEFAULT_SETTINGS)
  patch(s)
  return s
}

describe('settings catalog', () => {
  it('defaults match today\'s tiers', () => {
    for (const tier of ['free', 'plus', 'business', 'enterprise'] as const) {
      expect(entitlementsFor(tier, DEFAULT_SETTINGS)).toEqual(ENTITLEMENTS[tier])
    }
    expect(entitlementsFor('pro')).toEqual(ENTITLEMENTS.plus)
  })

  it('applies an in-range row', () => {
    const r = parseSettings([{ key: 'limits.anonymousDaily', value: 5000 }])
    expect(r.settings.anonymousDaily).toBe(5000)
    expect(r.rejected).toEqual([])
  })

  it('rejects below floor and above ceiling', () => {
    for (const value of [49, 1_000_001]) {
      const r = parseSettings([{ key: 'limits.anonymousDaily', value }])
      expect(r.settings.anonymousDaily).toBe(100)
      expect(r.rejected).toEqual(['limits.anonymousDaily'])
    }
  })

  it('rejects unknown key and wrong type', () => {
    const r = parseSettings([
      { key: 'limits.gold', value: 1 },
      { key: 'sizes.free.maxSize', value: '512' },
      { key: 'sizes.free.maxSize', value: 512.5 },
    ])
    expect(r.rejected).toEqual(['limits.gold', 'sizes.free.maxSize', 'sizes.free.maxSize'])
    expect(r.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('ignores one bad row and keeps the rest', () => {
    const r = parseSettings([
      { key: 'limits.anonymousDaily', value: 1e9 },
      { key: 'sizes.plus.maxSize', value: 768 },
    ])
    expect(r.settings.anonymousDaily).toBe(100)
    expect(r.settings.maxSize.plus).toBe(768)
    expect(r.rejected).toEqual(['limits.anonymousDaily'])
  })

  it('access must have exactly the four booleans', () => {
    expect(validateSetting('embeds.profileAccess', { free: true, plus: true, business: true }).ok).toBe(false)
    expect(validateSetting('embeds.profileAccess', { anonymous: 'yes', free: true, plus: true, business: true }).ok).toBe(false)
    expect(validateSetting('embeds.profileAccess', { anonymous: true, free: true, plus: true, business: true, extra: true }).ok).toBe(false)
    expect(validateSetting('embeds.profileAccess', { anonymous: true, free: false, plus: true, business: true }).ok).toBe(true)
  })

  it('entitlementsFor applies overrides and keeps enterprise fixed', () => {
    const s = withSettings((x) => {
      x.maxSize.free = 256
      x.profileAccess.free = true
    })
    expect(entitlementsFor('free', s).maxSize).toBe(256)
    expect(entitlementsFor('free', s).hovercards).toBe(true)
    expect(entitlementsFor('enterprise', s)).toEqual(ENTITLEMENTS.enterprise)
  })

  it('includedVolume reads settings', () => {
    const s = withSettings((x) => {
      x.keyedMonthly.plus = 75_000
    })
    expect(includedVolume('plus', s)).toEqual({ volume: 75000, per: 'month' })
    expect(includedVolume('plus')).toEqual({ volume: 50000, per: 'month' })
  })

  it('parseAvatarParams clamps to the settings max size', () => {
    const s = withSettings((x) => {
      x.maxSize.free = 256
    })
    const p = parseAvatarParams(new URLSearchParams('s=1024'), { tier: 'free', defaultUrlAllowlist: [], settings: s })
    expect(p.size).toBe(256)
    expect(p.adjusted).toContain('s')
  })

  it('catalog has every key with the paid volume note', () => {
    expect(SETTING_DEFS).toHaveLength(8)
    const paid = SETTING_DEFS.filter((d) => d.key.endsWith('keyedMonthly'))
    expect(paid).toHaveLength(2)
    for (const d of paid) expect(d.note).toBe('Display and usage alerts only. Not billed yet.')
  })
})
