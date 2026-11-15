import { describe, expect, it } from 'vitest'
import { activeEntry, holidayLookup, resolveHoliday } from '@blueyvatar/core'
import { countryNames, hasCountry, hasRegion, holidayId, holidaysOf, nextOccurrence, occurrenceSource, regionsOf } from './data'

describe('holiday data from date-holidays', () => {
  it('lists countries and regions', () => {
    expect(hasCountry('US')).toBe(true)
    expect(hasCountry('ZZ')).toBe(false)
    expect(countryNames().CA).toBe('Canada')
    expect(regionsOf('CA').ON).toBe('Ontario')
    expect(hasRegion('CA', 'ON')).toBe(true)
    expect(hasRegion('CA', 'XX')).toBe(false)
    expect(hasRegion('CA', '')).toBe(true)
  })
  it('US Thanksgiving 2026 is November 26', () => {
    const t = holidaysOf('US', '', 2026).find((h) => h.id === 'thanksgiving-day')
    expect(t).toMatchObject({ start: '2026-11-26', days: 1, type: 'public', popular: false })
  })
  it('Canada Victoria Day 2026 is May 18 (Ontario), not in the federal list', () => {
    expect(holidaysOf('CA', 'ON', 2026).find((h) => h.id === 'victoria-day')?.start).toBe('2026-05-18')
    expect(holidaysOf('CA', '', 2026).some((h) => h.id === 'victoria-day')).toBe(false)
  })
  it('marks observances and optional days as popular, and skips substitute days', () => {
    const us = holidaysOf('US', '', 2026)
    expect(us.find((h) => h.id === 'halloween')).toMatchObject({ popular: true, type: 'observance', start: '2026-10-31' })
    expect(us.find((h) => h.id === 'christmas-eve')?.popular).toBe(true)
    expect(us.some((h) => /substitute/.test(h.name))).toBe(false)
    expect(us.find((h) => h.id === 'independence-day')?.start).toBe('2026-07-04')
  })
  it('another country works too (UK Boxing Day, France Bastille Day)', () => {
    expect(holidaysOf('GB', '', 2026).find((h) => h.id === 'boxing-day')?.start).toBe('2026-12-26')
    expect(holidaysOf('FR', '', 2026).some((h) => h.start === '2026-07-14')).toBe(true)
  })
  it('makes stable ids', () => {
    expect(holidayId('Thanksgiving Day')).toBe('thanksgiving-day')
    expect(holidayId('Valentine’s Day')).toBe('valentine-s-day')
    expect(holidayId('  !!  ')).toBe('')
  })
  it('finds the next occurrence, across New Year', () => {
    expect(nextOccurrence('US', '', 'thanksgiving-day', '2026-11-27')).toEqual({ start: '2027-11-25', days: 1 })
    expect(nextOccurrence('US', '', 'nope', '2026-01-01')).toBeNull()
  })
  it('resolves a window with the owner zone', () => {
    const src = occurrenceSource('US', '')
    const picks = [{ id: 'thanksgiving-day', image: 'turkey', daysBefore: 2, daysAfter: 1 }]
    expect(resolveHoliday(picks, src, '2026-11-23')).toBeNull()
    expect(resolveHoliday(picks, src, '2026-11-24')?.image).toBe('turkey')
    expect(resolveHoliday(picks, src, '2026-11-27')?.image).toBe('turkey')
    expect(resolveHoliday(picks, src, '2026-11-28')).toBeNull()
    const lookup = holidayLookup({ country: 'US', region: '', picks: [{ ...picks[0]!, daysBefore: 0, daysAfter: 0 }] }, src)
    // 2026-11-26T03:00Z is still Nov 25 in Los Angeles, already Nov 26 in Auckland.
    const t = new Date('2026-11-26T03:00:00Z')
    expect(activeEntry({ dates: [], weekly: [] }, 'America/Los_Angeles', t, { holiday: lookup })).toBeNull()
    expect(activeEntry({ dates: [], weekly: [] }, 'Pacific/Auckland', t, { holiday: lookup })?.image).toBe('turkey')
  })
})
