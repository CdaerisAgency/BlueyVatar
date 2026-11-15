/** Patterns shared by the schedule and holiday rules. Import by subpath: `@blueyvatar/core/patterns`. */

/** A local calendar date, `YYYY-MM-DD` (shape only; callers check that the date exists). */
export const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A record key. Callers also refuse `.` and `..`. */
export const RKEY_RE = /^[A-Za-z0-9._:~-]{1,512}$/
