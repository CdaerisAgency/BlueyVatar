/**
 * Dates for the out-of-office window. The user picks calendar dates and a time zone; the window runs from the start
 * of the first day to the end of the last day in that zone (inclusive dates, like the design plan on #218).
 * The zone is an IANA name. An invalid name is rejected by the caller (isValidTimezone) before it gets here.
 */
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseDate(raw: string): { y: number; m: number; d: number } | null {
  const m = DATE.exec(raw.trim())
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const probe = new Date(Date.UTC(y, mo - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d ? { y, m: mo, d } : null
}

const fmt = new Map<string, Intl.DateTimeFormat>()
function parts(ms: number, tz: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  let f = fmt.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    fmt.set(tz, f)
  }
  const o: Record<string, number> = {}
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return { y: o.year!, m: o.month!, d: o.day!, h: o.hour!, mi: o.minute!, s: o.second! }
}

/** Offset of the zone from UTC at an instant, in milliseconds (east is positive). */
function offsetAt(ms: number, tz: string): number {
  const p = parts(ms, tz)
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000
}

/** The local calendar date (YYYY-MM-DD) in a zone at an instant. */
export function localDate(ms: number, tz: string): string {
  const p = parts(ms, tz)
  return `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

/**
 * The first instant of a local date in a zone. The offset is searched for, not assumed, so a DST change or a
 * 30 minute zone shift on that day does not move the answer. If the zone skips midnight that day, the answer is the
 * first instant of the date.
 */
export function startOfLocalDate(date: string, tz: string): Date {
  const p = parseDate(date)
  if (!p) throw new RangeError('invalid date')
  const wall = Date.UTC(p.y, p.m - 1, p.d)
  let t = wall
  for (let i = 0; i < 4; i++) t = wall - offsetAt(t, tz)
  // Walk back while the instant before is still the same local date (a repeated midnight), then forward if we landed before the date.
  while (localDate(t - 60_000, tz) === date) t -= 60_000
  while (localDate(t, tz) < date) t += 60_000
  return new Date(t)
}

export function addDays(date: string, n: number): string {
  const p = parseDate(date)!
  return new Date(Date.UTC(p.y, p.m - 1, p.d + n)).toISOString().slice(0, 10)
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
