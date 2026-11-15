import { describe, expect, it } from 'vitest'
import { holidayLookup, parseHolidaySettings, resolveHoliday, windowOf, type HolidayPick, type OccurrenceSource } from './holidays.js'
import { activeEntry, nextChange } from './schedule.js'

const pick = (id: string, image: string, daysBefore = 0, daysAfter = 0): HolidayPick => ({ id, image, daysBefore, daysAfter })

const table: Record<string, Record<number, { start: string; days: number }[]>> = {
  christmas: { 2026: [{ start: '2026-12-25', days: 1 }], 2027: [{ start: '2027-12-25', days: 1 }] },
  newyear: { 2027: [{ start: '2027-01-01', days: 1 }], 2026: [{ start: '2026-01-01', days: 1 }] },
  long: { 2026: [{ start: '2026-12-20', days: 5 }] },
}
const source: OccurrenceSource = (id, year) => table[id]?.[year] ?? []

describe('parseHolidaySettings', () => {
  it('keeps valid picks and drops bad ones', () => {
    const s = parseHolidaySettings({
      country: 'US',
      region: 'CA',
      picks: [pick('a', 'img1'), pick('a', 'img2'), pick('b', 'img1', 15, 0), pick('c', '..'), { id: 'd', image: 'x', daysBefore: 1.5, daysAfter: 0 }, pick('e', 'img3', 14, 14), 7],
    })
    expect(s.picks.map((p) => p.id)).toEqual(['a', 'e'])
    expect(s.picks[0]!.image).toBe('img1')
  })
  it('needs a two letter upper case country, and drops picks without one', () => {
    expect(parseHolidaySettings({ country: 'usa', picks: [pick('a', 'x')] })).toEqual({ country: '', region: '', picks: [] })
    expect(parseHolidaySettings(null)).toEqual({ country: '', region: '', picks: [] })
    expect(parseHolidaySettings({ country: 'CA', region: 'no way' }).region).toBe('')
  })
})

describe('resolveHoliday overlap rules', () => {
  const picks = [pick('christmas', 'xmas', 7, 7), pick('newyear', 'ny', 7, 7)]
  it('a window opens before and closes after', () => {
    expect(resolveHoliday(picks, source, '2026-12-17')).toBeNull()
    expect(resolveHoliday(picks, source, '2026-12-18')?.image).toBe('xmas')
    expect(resolveHoliday(picks, source, '2027-01-01')?.image).toBe('ny')
  })
  it('the closer holiday wins in an overlap (Dec 28 Christmas, Dec 29 New Year)', () => {
    expect(resolveHoliday(picks, source, '2026-12-28')?.image).toBe('xmas')
    expect(resolveHoliday(picks, source, '2026-12-29')?.image).toBe('ny')
  })
  it('an equal distance goes to the upcoming holiday over the one just past', () => {
    const t: OccurrenceSource = (id, y) => (y === 2026 ? ({ a: [{ start: '2026-12-26', days: 1 }], b: [{ start: '2026-12-30', days: 1 }] } as Record<string, { start: string; days: number }[]>)[id] ?? [] : [])
    // On Dec 28 the first holiday ended 2 days ago and the second is 2 days ahead.
    expect(resolveHoliday([pick('a', 'past', 5, 5), pick('b', 'soon', 5, 5)], t, '2026-12-28')?.image).toBe('soon')
    expect(resolveHoliday([pick('b', 'soon', 5, 5), pick('a', 'past', 5, 5)], t, '2026-12-28')?.image).toBe('soon')
  })
  it('a holiday on its own days beats another holiday window, even a closer one by days', () => {
    const t: OccurrenceSource = (id, y) => (y === 2026 ? ({ a: [{ start: '2026-12-20', days: 5 }], b: [{ start: '2026-12-25', days: 1 }] } as Record<string, { start: string; days: number }[]>)[id] ?? [] : [])
    // Dec 24 is inside a's span and one day before b.
    expect(resolveHoliday([pick('b', 'b', 3, 0), pick('a', 'a', 0, 0)], t, '2026-12-24')?.image).toBe('a')
  })
  it('a full tie keeps the earlier entry', () => {
    const t: OccurrenceSource = (id, y) => (y === 2026 ? [{ start: '2026-12-25', days: 1 }] : [])
    expect(resolveHoliday([pick('x', 'first', 2, 0), pick('y', 'second', 2, 0)], t, '2026-12-24')?.image).toBe('first')
    expect(resolveHoliday([pick('y', 'second', 2, 0), pick('x', 'first', 2, 0)], t, '2026-12-24')?.image).toBe('second')
  })
  it('uses the whole span of a multi day holiday', () => {
    const p = [pick('long', 'l', 0, 1)]
    expect(resolveHoliday(p, source, '2026-12-24')?.image).toBe('l')
    expect(resolveHoliday(p, source, '2026-12-25')?.image).toBe('l')
    expect(resolveHoliday(p, source, '2026-12-26')).toBeNull()
  })
  it('ignores picks the source does not know', () => {
    expect(resolveHoliday([pick('gone', 'g', 14, 14)], source, '2026-12-25')).toBeNull()
  })
  it('windowOf spans the holiday and its margins', () => {
    expect(windowOf(pick('long', 'l', 2, 3), { start: '2026-12-20', days: 5 })).toEqual({ from: '2026-12-18', to: '2026-12-27' })
  })
})

describe('holidays in the calendar precedence', () => {
  const schedule = { dates: [{ date: '2026-12-25', image: 'date' }], weekly: [{ weekday: 5 as const, image: 'weekly' }] }
  const holiday = holidayLookup({ country: 'US', region: '', picks: [pick('christmas', 'xmas', 2, 0)] }, source)
  it('date entry beats holiday, holiday beats weekly', () => {
    // 2026-12-25 and 2026-12-24 (Thursday) hold; 2026-12-23 is a Wednesday inside the window.
    expect(activeEntry(schedule, 'UTC', new Date('2026-12-25T12:00:00Z'), { holiday })).toMatchObject({ kind: 'date', image: 'date' })
    expect(activeEntry(schedule, 'UTC', new Date('2026-12-23T12:00:00Z'), { holiday })).toMatchObject({ kind: 'holiday', image: 'xmas' })
    // Friday 2026-12-18 is outside the window, so the weekly entry applies.
    expect(activeEntry(schedule, 'UTC', new Date('2026-12-18T12:00:00Z'), { holiday })).toMatchObject({ kind: 'weekly' })
  })
  it('uses the owner time zone, never the holiday country zone', () => {
    const h = holidayLookup({ country: 'US', region: '', picks: [pick('christmas', 'xmas')] }, source)
    // 2026-12-25T03:00Z is still Dec 24 in Los Angeles and already Dec 25 in Kiritimati (UTC+14).
    const t = new Date('2026-12-25T03:00:00Z')
    expect(activeEntry({ dates: [], weekly: [] }, 'America/Los_Angeles', t, { holiday: h })).toBeNull()
    expect(activeEntry({ dates: [], weekly: [] }, 'Pacific/Kiritimati', t, { holiday: h })?.image).toBe('xmas')
  })
  it('nextChange finds the start of the window in the owner zone', () => {
    const next = nextChange({ dates: [], weekly: [] }, 'America/Los_Angeles', new Date('2026-11-14T12:00:00Z'), { holiday })
    expect(next?.toISOString()).toBe('2026-12-23T08:00:00.000Z')
  })
})
