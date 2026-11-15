import { describe, expect, it } from 'vitest'
import {
  activeEntry,
  addDays,
  localDate,
  nextChange,
  nextLocalMidnight,
  parseSchedule,
  startOfLocalDay,
  weekdayOf,
} from './schedule.js'

const iso = (d: Date) => d.toISOString()

describe('localDate', () => {
  it('uses the zone, not UTC', () => {
    expect(localDate(new Date('2026-06-01T02:00:00Z'), 'America/New_York')).toBe('2026-05-31')
    expect(localDate(new Date('2026-06-01T23:00:00Z'), 'Pacific/Kiritimati')).toBe('2026-06-02')
    expect(localDate(new Date('2026-06-01T05:00:00Z'), 'Pacific/Pago_Pago')).toBe('2026-05-31')
  })
  it('falls back to UTC for an invalid zone', () => {
    expect(localDate(new Date('2026-06-01T23:30:00Z'), 'Not/AZone')).toBe('2026-06-01')
    expect(localDate(new Date('2026-06-01T23:30:00Z'), '')).toBe('2026-06-01')
    expect(iso(startOfLocalDay('2026-06-01', 'Not/AZone'))).toBe('2026-06-01T00:00:00.000Z')
  })
})

describe('startOfLocalDay and nextLocalMidnight', () => {
  it('handles New York spring forward (2026-03-08, 23 hour day)', () => {
    expect(iso(startOfLocalDay('2026-03-08', 'America/New_York'))).toBe('2026-03-08T05:00:00.000Z')
    expect(iso(startOfLocalDay('2026-03-09', 'America/New_York'))).toBe('2026-03-09T04:00:00.000Z')
    expect(iso(nextLocalMidnight(new Date('2026-03-08T12:00:00Z'), 'America/New_York'))).toBe(
      '2026-03-09T04:00:00.000Z',
    )
  })
  it('handles New York fall back (2026-11-01, 25 hour day)', () => {
    expect(iso(startOfLocalDay('2026-11-01', 'America/New_York'))).toBe('2026-11-01T04:00:00.000Z')
    expect(iso(nextLocalMidnight(new Date('2026-11-01T04:00:00Z'), 'America/New_York'))).toBe(
      '2026-11-02T05:00:00.000Z',
    )
  })
  it('handles Lord Howe 30 minute shift (2026-04-05 fall back, 2026-10-04 spring forward)', () => {
    // Offset +11:00 until 02:00 local on 2026-04-05, then +10:30.
    expect(iso(startOfLocalDay('2026-04-05', 'Australia/Lord_Howe'))).toBe('2026-04-04T13:00:00.000Z')
    expect(iso(startOfLocalDay('2026-04-06', 'Australia/Lord_Howe'))).toBe('2026-04-05T13:30:00.000Z')
    // Offset +10:30 until 02:00 local on 2026-10-04, then +11:00.
    expect(iso(startOfLocalDay('2026-10-04', 'Australia/Lord_Howe'))).toBe('2026-10-03T13:30:00.000Z')
    expect(iso(startOfLocalDay('2026-10-05', 'Australia/Lord_Howe'))).toBe('2026-10-04T13:00:00.000Z')
  })
  it('handles Kiritimati (+14), Pago Pago (-11) and Kathmandu (+5:45)', () => {
    expect(iso(startOfLocalDay('2026-06-02', 'Pacific/Kiritimati'))).toBe('2026-06-01T10:00:00.000Z')
    expect(iso(startOfLocalDay('2026-06-02', 'Pacific/Pago_Pago'))).toBe('2026-06-02T11:00:00.000Z')
    expect(iso(startOfLocalDay('2026-06-02', 'Asia/Kathmandu'))).toBe('2026-06-01T18:15:00.000Z')
    expect(iso(nextLocalMidnight(new Date('2026-06-02T00:00:00Z'), 'Asia/Kathmandu'))).toBe(
      '2026-06-02T18:15:00.000Z',
    )
  })
  it('round trips: the start instant is on the date and one ms earlier is not', () => {
    for (const tz of ['America/New_York', 'Australia/Lord_Howe', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kathmandu']) {
      for (const date of ['2026-03-08', '2026-11-01', '2026-04-05', '2026-10-04', '2026-07-15']) {
        const s = startOfLocalDay(date, tz)
        expect(localDate(s, tz)).toBe(date)
        expect(localDate(new Date(s.getTime() - 1), tz) < date).toBe(true)
      }
    }
  })
  it('rejects a malformed date', () => {
    expect(() => startOfLocalDay('2026-02-30', 'UTC')).toThrow(RangeError)
  })
})

describe('parseSchedule', () => {
  it('keeps valid entries and drops unknown values', () => {
    const s = parseSchedule({
      dates: [
        { date: '2026-12-25', image: 'abc' },
        { date: '2026-02-30', image: 'abc' },
        { date: '2026-12-25', image: 'dup' },
        { date: '2026-01-01', image: '' },
        { date: '2026-01-02', image: 'has space' },
        { date: 5, image: 'x' },
        null,
      ],
      weekly: [
        { weekday: 1, image: 'mon' },
        { weekday: 7, image: 'bad' },
        { weekday: 1.5, image: 'bad' },
        { weekday: 1, image: 'again' },
        { weekday: '2', image: 'bad' },
      ],
      extra: true,
    })
    expect(s).toEqual({ dates: [{ date: '2026-12-25', image: 'abc' }], weekly: [{ weekday: 1, image: 'mon' }] })
  })
  it('returns an empty schedule for junk', () => {
    expect(parseSchedule(null)).toEqual({ dates: [], weekly: [] })
    expect(parseSchedule('x')).toEqual({ dates: [], weekly: [] })
    expect(parseSchedule({ dates: 3, weekly: {} })).toEqual({ dates: [], weekly: [] })
  })
})

describe('activeEntry', () => {
  const s = parseSchedule({
    dates: [{ date: '2026-03-08', image: 'special' }],
    weekly: [
      { weekday: 0, image: 'sun' },
      { weekday: 1, image: 'mon' },
    ],
  })
  it('prefers date over weekly, and weekly over none', () => {
    // 2026-03-08 is a Sunday.
    expect(weekdayOf('2026-03-08')).toBe(0)
    expect(activeEntry(s, 'America/New_York', new Date('2026-03-08T12:00:00Z'))).toEqual({
      kind: 'date',
      date: '2026-03-08',
      image: 'special',
    })
    expect(activeEntry(s, 'America/New_York', new Date('2026-03-09T12:00:00Z'))).toEqual({
      kind: 'weekly',
      weekday: 1,
      image: 'mon',
    })
    expect(activeEntry(s, 'America/New_York', new Date('2026-03-10T12:00:00Z'))).toBeNull()
  })
  it('window is inclusive of the whole local day on both ends', () => {
    const at = (iso: string) => activeEntry(s, 'America/New_York', new Date(iso))?.image
    // Local 2026-03-08 runs 05:00Z to 04:00Z next day (23 hours).
    expect(at('2026-03-08T04:59:59.999Z')).toBeUndefined()
    expect(at('2026-03-08T05:00:00.000Z')).toBe('special')
    expect(at('2026-03-09T03:59:59.999Z')).toBe('special')
    expect(at('2026-03-09T04:00:00.000Z')).toBe('mon')
  })
  it('uses UTC for an invalid zone', () => {
    expect(activeEntry(s, 'bogus', new Date('2026-03-08T00:00:00Z'))?.image).toBe('special')
  })
  it('lets a holiday sit between date and weekly entries', () => {
    const holiday = (d: string) => (d === '2026-03-09' || d === '2026-03-08' ? 'hol' : null)
    expect(activeEntry(s, 'UTC', new Date('2026-03-08T10:00:00Z'), { holiday })?.image).toBe('special')
    expect(activeEntry(s, 'UTC', new Date('2026-03-09T10:00:00Z'), { holiday })).toEqual({
      kind: 'holiday',
      date: '2026-03-09',
      image: 'hol',
    })
  })
})

describe('nextChange', () => {
  const s = parseSchedule({
    dates: [{ date: '2026-03-08', image: 'special' }],
    weekly: [{ weekday: 1, image: 'mon' }],
  })
  it('returns the next local midnight where the image changes', () => {
    expect(iso(nextChange(s, 'America/New_York', new Date('2026-03-08T12:00:00Z'))!)).toBe(
      '2026-03-09T04:00:00.000Z',
    )
    // From Monday the image changes at Tuesday's start.
    expect(iso(nextChange(s, 'America/New_York', new Date('2026-03-09T12:00:00Z'))!)).toBe(
      '2026-03-10T04:00:00.000Z',
    )
  })
  it('skips days with the same image and finds the next Monday', () => {
    expect(iso(nextChange(s, 'UTC', new Date('2026-03-10T12:00:00Z'))!)).toBe('2026-03-16T00:00:00.000Z')
  })
  it('is null when nothing changes within 400 days', () => {
    expect(nextChange({ dates: [], weekly: [] }, 'UTC', new Date('2026-03-10T12:00:00Z'))).toBeNull()
    const far = parseSchedule({ dates: [{ date: '2028-01-01', image: 'x' }] })
    expect(nextChange(far, 'UTC', new Date('2026-03-10T12:00:00Z'))).toBeNull()
  })
  it('finds a change on day 400 and not on day 401', () => {
    const now = new Date('2026-03-10T12:00:00Z')
    expect(nextChange(parseSchedule({ dates: [{ date: addDays('2026-03-10', 400), image: 'x' }] }), 'UTC', now)).not.toBeNull()
    expect(nextChange(parseSchedule({ dates: [{ date: addDays('2026-03-10', 401), image: 'x' }] }), 'UTC', now)).toBeNull()
  })
})
