import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@blueyvatar/core/settings'
import { formatVolume, getSiteSettings } from './site-settings'

describe('formatVolume', () => {
  it('formats counts', () => {
    expect(formatVolume(1000)).toBe('1,000')
    expect(formatVolume(50_000)).toBe('50,000')
    expect(formatVolume(1_000_000)).toBe('1 million')
    expect(formatVolume(2_500_000)).toBe('2.5 million')
    expect(formatVolume(999_999)).toBe('999,999')
  })
})

describe('getSiteSettings', () => {
  afterEach(() => { delete (globalThis as { __bvSettings?: unknown }).__bvSettings })
  it('serves defaults without a database', async () => {
    delete process.env.DATABASE_URL
    expect(await getSiteSettings()).toBe(DEFAULT_SETTINGS)
    expect(await getSiteSettings()).toBe(DEFAULT_SETTINGS)
  })
})
