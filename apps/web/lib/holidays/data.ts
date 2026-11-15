import Holidays from 'date-holidays'
import type { HolidayOccurrence, OccurrenceSource } from '@blueyvatar/core'

/**
 * Holiday data (issue #220) from the `date-holidays` library, pinned in package.json. Its data is CC BY-SA 4.0
 * (see docs/holidays-v1.md and the credit on the holidays page). We do not change or copy the data.
 *
 * Time zones: the library dates a holiday in its own country's zone. We only read the calendar date it prints,
 * and the owner's zone decides when that date starts (packages/core/src/schedule.ts), never the country's.
 */

export type HolidayType = 'public' | 'bank' | 'observance' | 'optional'
/** Types we list. School and other types are left out. */
const LISTED: ReadonlySet<string> = new Set(['public', 'bank', 'observance', 'optional'])

export interface HolidayInfo {
  id: string
  name: string
  type: HolidayType
  /** Observances and optional days: widely marked, no day off by law. Shown as "popular". */
  popular: boolean
  start: string
  days: number
}

const DAY_MS = 86_400_000

/** Stable id from the English name. Letters and numbers only, lowercase, at most 64 characters. */
export function holidayId(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

const instances = new Map<string, Holidays | null>()
function libFor(country: string, region: string): Holidays | null {
  const key = `${country}/${region}`
  let h = instances.get(key)
  if (h === undefined) {
    try {
      h = region ? new Holidays(country, region) : new Holidays(country)
      if (!h.getCountries()[country]) h = null
    } catch {
      h = null
    }
    instances.set(key, h)
  }
  return h
}

/** Country code to English name, from the library. */
export function countryNames(): Record<string, string> {
  return new Holidays().getCountries('en') as Record<string, string>
}

export function hasCountry(country: string): boolean {
  return Object.hasOwn(countryNames(), country)
}

/** Subdivision code to name for a country, or an empty object when the library lists none. */
export function regionsOf(country: string): Record<string, string> {
  if (!hasCountry(country)) return {}
  return (new Holidays().getStates(country, 'en') as Record<string, string> | undefined) ?? {}
}

export function hasRegion(country: string, region: string): boolean {
  return region === '' || Object.hasOwn(regionsOf(country), region)
}

const yearCache = new Map<string, HolidayInfo[]>()

/**
 * The holidays of one country (and region) that start in `year`, one entry per id. A "substitute day" (the day off
 * moved to a weekday) is not listed: the holiday's own date is used.
 */
export function holidaysOf(country: string, region: string, year: number): HolidayInfo[] {
  const key = `${country}/${region}/${year}`
  const hit = yearCache.get(key)
  if (hit) return hit
  const lib = libFor(country, region)
  const out: HolidayInfo[] = []
  if (lib) {
    let list: ReturnType<Holidays['getHolidays']> = []
    try {
      list = lib.getHolidays(year, 'en')
    } catch {
      list = []
    }
    const seen = new Set<string>()
    for (const h of list) {
      if (!LISTED.has(h.type) || h.substitute) continue
      const id = holidayId(h.name)
      if (!id || seen.has(id)) continue
      seen.add(id)
      const days = Math.max(1, Math.round((h.end.getTime() - h.start.getTime()) / DAY_MS))
      out.push({ id, name: h.name, type: h.type as HolidayType, popular: h.type === 'observance' || h.type === 'optional', start: h.date.slice(0, 10), days })
    }
  }
  if (yearCache.size > 500) yearCache.clear()
  yearCache.set(key, out)
  return out
}

/** The source the resolver in packages/core reads. */
export function occurrenceSource(country: string, region: string): OccurrenceSource {
  const years = new Map<number, Map<string, HolidayOccurrence[]>>()
  return (id, year) => {
    let byId = years.get(year)
    if (!byId) {
      byId = new Map()
      for (const h of holidaysOf(country, region, year)) byId.set(h.id, [{ start: h.start, days: h.days }])
      years.set(year, byId)
    }
    return byId.get(id) ?? []
  }
}

/** The next occurrence of a holiday on or after a local date, looking at most two years ahead. */
export function nextOccurrence(country: string, region: string, id: string, fromDate: string): HolidayOccurrence | null {
  const year = Number(fromDate.slice(0, 4))
  const src = occurrenceSource(country, region)
  for (const y of [year, year + 1, year + 2]) {
    for (const o of src(id, y)) if (o.start >= fromDate) return o
  }
  return null
}

/** The holiday data as the schedule flow takes it (ScheduleDeps.holidays). */
export const liveHolidayData = { hasCountry, hasRegion, occurrences: occurrenceSource }
