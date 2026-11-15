/**
 * Dates for the out-of-office window. The user picks calendar dates and a time zone; the window runs from the start
 * of the first day to the end of the last day in that zone (inclusive dates, like the design plan on #218).
 * The zone is an IANA name. An invalid name is rejected by the caller (isValidTimezone) before it gets here.
 */
import { addDays, localDate as coreLocalDate, startOfLocalDay } from '@blueyvatar/core/schedule'
import { DATE_RE } from '@blueyvatar/core/patterns'

export { addDays }

export function parseDate(raw: string): { y: number; m: number; d: number } | null {
  const m = DATE_RE.exec(raw.trim())
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const probe = new Date(Date.UTC(y, mo - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d ? { y, m: mo, d } : null
}

/** The local calendar date (YYYY-MM-DD) in a zone at an instant. Shares the core implementation. */
export function localDate(ms: number, tz: string): string {
  return coreLocalDate(new Date(ms), tz)
}

/**
 * The first instant of a local date in a zone. Shares the core implementation, which searches for the instant the
 * date changes, so a DST change or a 30 minute zone shift does not move the answer. If the zone skips midnight that
 * day, the answer is the first instant of the date.
 */
export function startOfLocalDate(date: string, tz: string): Date {
  if (!parseDate(date)) throw new RangeError('invalid date')
  return startOfLocalDay(date, tz)
}

export const MAX_AWAY_DAYS = 366

export type AwayWindow = { startAt: Date; endAt: Date }

/** Instants for an inclusive date range in a zone: from the start of `start` to the start of the day after `end`. */
export function awayWindow(start: string, end: string, tz: string): AwayWindow {
  return { startAt: startOfLocalDate(start, tz), endAt: startOfLocalDate(addDays(end, 1), tz) }
}

export function validateAway(startRaw: string, endRaw: string, tz: string, now: Date): { ok: true; value: AwayWindow & { start: string; end: string } } | { ok: false; error: string } {
  const s = parseDate(startRaw), e = parseDate(endRaw)
  if (!s) return { ok: false, error: 'Enter a start date.' }
  if (!e) return { ok: false, error: 'Enter an end date.' }
  const start = startRaw.trim(), end = endRaw.trim()
  if (end < start) return { ok: false, error: 'The end date must be the same as or after the start date.' }
  if (end < localDate(now.getTime(), tz)) return { ok: false, error: 'The end date has already passed.' }
  if (end > addDays(start, MAX_AWAY_DAYS - 1)) return { ok: false, error: `The window can be at most ${MAX_AWAY_DAYS} days.` }
  return { ok: true, value: { start, end, ...awayWindow(start, end, tz) } }
}
