import { describe, expect, it } from 'vitest'
import { TIMEZONE_ENTRIES, entryForZone, formatOffset, isListedZone, offsetMinutes, zoneLabel, zoneSignature } from './timezones'
import { isValidTimezone } from './records'

describe('time zone short list', () => {
  it('has between 30 and 50 entries', () => {
    expect(TIMEZONE_ENTRIES.length).toBeGreaterThanOrEqual(30)
    expect(TIMEZONE_ENTRIES.length).toBeLessThanOrEqual(50)
  })

  it('uses only valid IANA zones that the server accepts', () => {
    for (const e of TIMEZONE_ENTRIES) {
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: e.id }), e.id).not.toThrow()
      expect(isValidTimezone(e.id), e.id).toBe(true)
    }
  })

  it('has no repeated ids', () => {
    expect(new Set(TIMEZONE_ENTRIES.map((e) => e.id)).size).toBe(TIMEZONE_ENTRIES.length)
  })

  it('has no two entries with the same offset and daylight-saving rule', () => {
    const seen = new Map<string, string>()
    for (const e of TIMEZONE_ENTRIES) {
      const sig = zoneSignature(e.id)!
      expect(sig, e.id).toBeTruthy()
      expect(seen.get(sig), `${e.id} repeats ${seen.get(sig)}`).toBeUndefined()
      seen.set(sig, e.id)
    }
  })

  it('is sorted by standard offset, then name', () => {
    const sorted = [...TIMEZONE_ENTRIES].sort((a, b) => a.std - b.std || a.name.localeCompare(b.name, 'en'))
    expect(TIMEZONE_ENTRIES.map((e) => e.id)).toEqual(sorted.map((e) => e.id))
  })

  it('states the real standard offset for every entry', () => {
    const jan = new Date(Date.UTC(2026, 0, 1))
    const jul = new Date(Date.UTC(2026, 6, 1))
    for (const e of TIMEZONE_ENTRIES) {
      expect(Math.min(offsetMinutes(e.id, jan)!, offsetMinutes(e.id, jul)!), e.id).toBe(e.std)
    }
  })

  it('covers the half-hour and 45-minute zones', () => {
    const std = new Set(TIMEZONE_ENTRIES.map((e) => e.std))
    for (const m of [-210, 210, 270, 330, 345, 390, 570, 765]) expect(std.has(m), String(m)).toBe(true)
  })

  it('labels entries with the offset', () => {
    expect(zoneLabel(TIMEZONE_ENTRIES.find((e) => e.id === 'America/New_York')!)).toBe('(UTC-05:00) Eastern Time, New York')
    expect(formatOffset(345)).toBe('+05:45')
    expect(formatOffset(0)).toBe('+00:00')
  })

  it('maps a zone that is not listed to the entry with the same clock', () => {
    expect(entryForZone('America/Toronto')?.id).toBe('America/New_York')
    expect(entryForZone('Asia/Calcutta')?.id).toBe('Asia/Kolkata')
    expect(entryForZone('America/New_York')?.id).toBe('America/New_York')
    expect(entryForZone('Not/AZone')).toBeNull()
    expect(isListedZone('America/Toronto')).toBe(false)
    expect(isListedZone('America/New_York')).toBe(true)
  })

  it('keeps accepting valid zones that are not in the list', () => {
    expect(isValidTimezone('America/Toronto')).toBe(true)
    expect(isValidTimezone('Europe/Madrid')).toBe(true)
    expect(isValidTimezone('Nope/Nothing')).toBe(false)
  })
})
