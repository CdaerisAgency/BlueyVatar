import { describe, expect, it } from 'vitest'
import { addDays, awayWindow, localDate, parseDate, startOfLocalDate, validateAway } from './time'

describe('startOfLocalDate', () => {
  it('finds midnight in a fixed zone', () => {
    expect(startOfLocalDate('2026-06-01', 'UTC').toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(startOfLocalDate('2026-06-01', 'Asia/Kathmandu').toISOString()).toBe('2026-05-31T18:15:00.000Z')
    expect(startOfLocalDate('2026-06-01', 'Pacific/Kiritimati').toISOString()).toBe('2026-05-31T10:00:00.000Z')
  })
  it('follows daylight saving changes', () => {
    expect(startOfLocalDate('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z') // still EST at midnight
    expect(startOfLocalDate('2026-03-09', 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z') // EDT
    expect(startOfLocalDate('2026-11-01', 'America/New_York').toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(startOfLocalDate('2026-11-02', 'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z')
  })
  it('handles a 30 minute shift', () => {
    expect(startOfLocalDate('2026-04-05', 'Australia/Lord_Howe').toISOString()).toBe('2026-04-04T13:00:00.000Z') // +11 before the change
    expect(startOfLocalDate('2026-04-06', 'Australia/Lord_Howe').toISOString()).toBe('2026-04-05T13:30:00.000Z') // +10:30 after
  })
  it('always lands on the asked date', () => {
    for (const tz of ['UTC', 'America/New_York', 'Australia/Lord_Howe', 'Pacific/Pago_Pago', 'Asia/Kathmandu']) {
      const t = startOfLocalDate('2026-11-14', tz)
      expect(localDate(t.getTime(), tz)).toBe('2026-11-14')
      expect(localDate(t.getTime() - 60_000, tz)).toBe('2026-11-13')
    }
  })
})

describe('dates', () => {
  it('parses real dates only', () => {
    expect(parseDate('2026-02-28')).toEqual({ y: 2026, m: 2, d: 28 })
    expect(parseDate('2026-02-30')).toBeNull()
    expect(parseDate('nope')).toBeNull()
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('makes the end the start of the day after the last day', () => {
    const w = awayWindow('2026-11-14', '2026-11-14', 'UTC')
    expect(w.endAt.getTime() - w.startAt.getTime()).toBe(86_400_000)
  })
})

describe('validateAway', () => {
  const now = new Date('2026-11-14T12:00:00Z')
  it('accepts a window that starts today', () => expect(validateAway('2026-11-14', '2026-11-18', 'UTC', now).ok).toBe(true))
  it('rejects an end before the start, a past end, and a long window', () => {
    expect(validateAway('2026-11-18', '2026-11-14', 'UTC', now)).toMatchObject({ ok: false })
    expect(validateAway('2026-11-01', '2026-11-13', 'UTC', now)).toMatchObject({ ok: false })
    expect(validateAway('2026-11-14', '2028-01-01', 'UTC', now)).toMatchObject({ ok: false })
    expect(validateAway('', '2026-11-14', 'UTC', now)).toMatchObject({ ok: false })
  })
})
