/**
 * Avatar calendar date logic (#219). Pure and dependency free: every function
 * takes the instant and the owner's IANA zone, and never reads the server's
 * zone or clock. The settings live in the service database; the indexer tick
 * uses these functions to decide which image should be the default right now.
 */

/** Weekday number, 0 = Sunday through 6 = Saturday (same as `Date#getUTCDay`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface DateEntry {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string
  /** Record key of the image to show. */
  image: string
}

export interface WeeklyEntry {
  weekday: Weekday
  image: string
}

export interface Schedule {
  dates: DateEntry[]
  weekly: WeeklyEntry[]
}

export type ActiveEntry =
  | { kind: 'date'; date: string; image: string }
  | { kind: 'holiday'; date: string; image: string }
  | { kind: 'weekly'; weekday: Weekday; image: string }

/**
 * Extension point for holiday windows (#220). It returns the image rkey for a
 * local date, or null when no holiday applies. Precedence is date entry, then
 * holiday, then weekly entry. Nothing in this file implements holidays.
 */
export type HolidayLookup = (localDate: string) => string | null

export interface ScheduleOptions {
  holiday?: HolidayLookup
}

export const MAX_DATE_ENTRIES = 1000
/** How far nextChange looks ahead, in local days. */
export const MAX_LOOKAHEAD_DAYS = 400

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const RKEY_RE = /^[A-Za-z0-9._:~-]{1,512}$/
const DAY_MS = 86_400_000
const STEP_MS = 30 * 60_000

function isRealDate(s: string): boolean {
  const m = DATE_RE.exec(s)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

function isRkey(v: unknown): v is string {
  return typeof v === 'string' && v !== '.' && v !== '..' && RKEY_RE.test(v)
}

const formatters = new Map<string, Intl.DateTimeFormat | null>()

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        calendar: 'gregory',
        numberingSystem: 'latn',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
    } catch {
      f = null
    }
    formatters.set(tz, f)
  }
  return f ?? formatterFor('UTC')
}

/** True when `tz` is an IANA zone the runtime knows. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** The zone's local date (`YYYY-MM-DD`) at `instant`. An invalid zone means UTC. */
export function localDate(instant: Date, tz: string): string {
  const t = instant.getTime()
  if (!Number.isFinite(t)) throw new RangeError('invalid instant')
  let y = ''
  let m = ''
  let d = ''
  for (const p of formatterFor(isValidTimeZone(tz) ? tz : 'UTC').formatToParts(instant)) {
    if (p.type === 'year') y = p.value
    else if (p.type === 'month') m = p.value
    else if (p.type === 'day') d = p.value
  }
  return `${y.padStart(4, '0')}-${m}-${d}`
}

/** Adds whole calendar days to a `YYYY-MM-DD` date (pure calendar math, no zone). */
export function addDays(date: string, days: number): string {
  const m = DATE_RE.exec(date)
  if (!m) throw new RangeError('invalid date')
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
  return t.toISOString().slice(0, 10)
}

/** Weekday of a `YYYY-MM-DD` calendar date. */
export function weekdayOf(date: string): Weekday {
  const m = DATE_RE.exec(date)
  if (!m) throw new RangeError('invalid date')
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() as Weekday
}

/**
 * The first instant at which the zone's local date is `date` or later. Found
 * by searching for the instant the date changes, so skipped or repeated
 * midnights and 30 or 45 minute offsets are handled. If the zone skipped the
 * whole date, this is the start of the next local day that exists.
 */
export function startOfLocalDay(date: string, tz: string): Date {
  const m = DATE_RE.exec(date)
  if (!m || !isRealDate(date)) throw new RangeError('invalid date')
  const zone = isValidTimeZone(tz) ? tz : 'UTC'
  const utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  // Offsets stay within +/-14h, so the change lies inside this window.
  let lo = utcMidnight - 15 * 3_600_000
  const end = utcMidnight + 15 * 3_600_000
  const reached = (t: number) => localDate(new Date(t), zone) >= date
  if (reached(lo)) {
    // Only possible for odd historical zones; walk back to a failing point.
    while (reached(lo)) lo -= DAY_MS
  }
  let hi = lo
  while (hi < end && !reached(hi)) hi += STEP_MS
  // Invariant: lo fails (or is the window start), hi passes. Refine to the ms.
  lo = Math.max(lo, hi - STEP_MS)
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2)
    if (reached(mid)) hi = mid
    else lo = mid
  }
  return new Date(hi)
}

/** The start of the local day after the one containing `instant`. */
export function nextLocalMidnight(instant: Date, tz: string): Date {
  return startOfLocalDay(addDays(localDate(instant, tz), 1), tz)
}

/** Validates untrusted input. Unknown or malformed values are dropped. */
export function parseSchedule(input: unknown): Schedule {
  const out: Schedule = { dates: [], weekly: [] }
  if (typeof input !== 'object' || input === null) return out
  const raw = input as { dates?: unknown; weekly?: unknown }
  if (Array.isArray(raw.dates)) {
    const seen = new Set<string>()
    for (const e of raw.dates) {
      if (out.dates.length >= MAX_DATE_ENTRIES) break
      if (typeof e !== 'object' || e === null) continue
      const { date, image } = e as { date?: unknown; image?: unknown }
      if (typeof date !== 'string' || !isRealDate(date) || !isRkey(image) || seen.has(date)) continue
      seen.add(date)
      out.dates.push({ date, image })
    }
    out.dates.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }
  if (Array.isArray(raw.weekly)) {
    const seen = new Set<number>()
    for (const e of raw.weekly) {
      if (typeof e !== 'object' || e === null) continue
      const { weekday, image } = e as { weekday?: unknown; image?: unknown }
      if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue
      if (!isRkey(image) || seen.has(weekday)) continue
      seen.add(weekday)
      out.weekly.push({ weekday: weekday as Weekday, image })
    }
    out.weekly.sort((a, b) => a.weekday - b.weekday)
  }
  return out
}

/** The entry for a local calendar date: date entry, then holiday, then weekly. */
export function activeEntryForDate(
  schedule: Schedule,
  date: string,
  options: ScheduleOptions = {},
): ActiveEntry | null {
  const d = schedule.dates.find((e) => e.date === date)
  if (d) return { kind: 'date', date, image: d.image }
  const holiday = options.holiday?.(date)
  if (holiday) return { kind: 'holiday', date, image: holiday }
  const weekday = weekdayOf(date)
  const w = schedule.weekly.find((e) => e.weekday === weekday)
  if (w) return { kind: 'weekly', weekday, image: w.image }
  return null
}

/** The entry in force at `now` in the owner's zone, or null when none applies. */
export function activeEntry(
  schedule: Schedule,
  tz: string,
  now: Date,
  options: ScheduleOptions = {},
): ActiveEntry | null {
  return activeEntryForDate(schedule, localDate(now, tz), options)
}

/**
 * The next instant, after `now`, at which the active image changes: the start
 * of the first local day within MAX_LOOKAHEAD_DAYS whose entry names a
 * different image. Null when nothing changes in that range.
 */
export function nextChange(
  schedule: Schedule,
  tz: string,
  now: Date,
  options: ScheduleOptions = {},
): Date | null {
  const today = localDate(now, tz)
  const current = activeEntryForDate(schedule, today, options)?.image ?? null
  for (let i = 1; i <= MAX_LOOKAHEAD_DAYS; i++) {
    const day = addDays(today, i)
    if ((activeEntryForDate(schedule, day, options)?.image ?? null) !== current) {
      return startOfLocalDay(day, tz)
    }
  }
  return null
}
