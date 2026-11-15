/**
 * Holiday avatar rules (#220). Pure: the holiday data itself comes from the caller (apps/web reads it from the
 * date-holidays library), so this file only validates a user's picks and decides which pick wins on a local date.
 * Dates are `YYYY-MM-DD` strings in the owner's time zone. The holiday's country zone is never used.
 */
import { addDays, type HolidayLookup } from './schedule.js'
import { DATE_RE, RKEY_RE } from './patterns.js'

export interface HolidayPick {
  /** Holiday id, derived by the web app from the library's English name. */
  id: string
  /** Record key of the image to show. */
  image: string
  daysBefore: number
  daysAfter: number
}

export interface HolidaySettings {
  /** ISO 3166-1 alpha-2 code, or empty when no country is chosen. */
  country: string
  /** Subdivision code (for example a US state), or empty. */
  region: string
  picks: HolidayPick[]
}

/** One occurrence of a holiday: its first local date and how many days it lasts (1 for most). */
export interface HolidayOccurrence {
  start: string
  days: number
}

/** The occurrences of holiday `id` that start in the given calendar year. */
export type OccurrenceSource = (id: string, year: number) => HolidayOccurrence[]

export const MAX_HOLIDAY_PICKS = 100
export const MAX_WINDOW_DAYS = 14

const ID_MAX = 64

export const emptyHolidaySettings = (): HolidaySettings => ({ country: '', region: '', picks: [] })

const isWindow = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_WINDOW_DAYS

/** Validates untrusted input. Unknown or malformed values are dropped, duplicate ids keep the first. */
export function parseHolidaySettings(input: unknown): HolidaySettings {
  const out = emptyHolidaySettings()
  if (typeof input !== 'object' || input === null) return out
  const raw = input as { country?: unknown; region?: unknown; picks?: unknown }
  if (typeof raw.country === 'string' && /^[A-Z]{2}$/.test(raw.country)) {
    out.country = raw.country
    if (typeof raw.region === 'string' && /^[A-Z0-9]{1,3}$/.test(raw.region)) out.region = raw.region
  }
  if (out.country && Array.isArray(raw.picks)) {
    const seen = new Set<string>()
    for (const e of raw.picks) {
      if (out.picks.length >= MAX_HOLIDAY_PICKS) break
      if (typeof e !== 'object' || e === null) continue
      const { id, image, daysBefore, daysAfter } = e as Record<string, unknown>
      if (typeof id !== 'string' || id === '' || id.length > ID_MAX || seen.has(id)) continue
      if (typeof image !== 'string' || image === '.' || image === '..' || !RKEY_RE.test(image)) continue
      if (!isWindow(daysBefore) || !isWindow(daysAfter)) continue
      seen.add(id)
      out.picks.push({ id, image, daysBefore, daysAfter })
    }
  }
  return out
}

function dayNumber(date: string): number {
  const m = DATE_RE.exec(date)
  if (!m) throw new RangeError('invalid date')
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000)
}

/**
 * The pick that applies on a local date, or null. A pick applies from `daysBefore` days before an occurrence starts
 * until `daysAfter` days after it ends. When several apply: a holiday whose own span contains the date wins, then the
 * closest span, an upcoming holiday over one just past, then the earlier pick in the list. Occurrences are read for
 * the year before, the year of, and the year after the date, so a window can cross New Year.
 */
export function resolveHoliday(picks: HolidayPick[], occurrences: OccurrenceSource, date: string): HolidayPick | null {
  const today = dayNumber(date)
  const year = Number(date.slice(0, 4))
  let best: { pick: HolidayPick; distance: number; upcoming: boolean } | null = null
  for (const pick of picks) {
    for (const y of [year - 1, year, year + 1]) {
      for (const o of occurrences(pick.id, y)) {
        const first = dayNumber(o.start)
        const last = first + Math.max(1, o.days) - 1
        if (today < first - pick.daysBefore || today > last + pick.daysAfter) continue
        const distance = today < first ? first - today : today > last ? today - last : 0
        const upcoming = today < first
        // Strictly better only: a tie keeps the earlier pick, which was seen first.
        if (!best || distance < best.distance || (distance === best.distance && upcoming && !best.upcoming)) {
          best = { pick, distance, upcoming }
        }
      }
    }
  }
  return best ? best.pick : null
}

/** The `holiday` hook for `activeEntry` and `nextChange` in schedule.ts. */
export function holidayLookup(settings: HolidaySettings, occurrences: OccurrenceSource): HolidayLookup {
  return (date) => resolveHoliday(settings.picks, occurrences, date)?.image ?? null
}

/** The local dates (inclusive) on which a pick shows for one occurrence, before overlap is applied. */
export function windowOf(pick: Pick<HolidayPick, 'daysBefore' | 'daysAfter'>, o: HolidayOccurrence): { from: string; to: string } {
  return { from: addDays(o.start, -pick.daysBefore), to: addDays(o.start, Math.max(1, o.days) - 1 + pick.daysAfter) }
}
