import type pg from 'pg'
import { errors, log } from './obs.js'

/** Deletes rate window rows whose window has ended. Returns the number removed. */
export async function cleanupRateWindows(pool: pg.Pool): Promise<number> {
  const res = await pool.query('DELETE FROM rate_windows WHERE reset_at <= now()')
  return res.rowCount ?? 0
}

/** Runs the cleanup on an interval (default daily; expired rows are reset on next use, so this only reclaims space). Failures are logged and retried on the next tick. */
export function scheduleRateWindowCleanup(pool: pg.Pool, everyMs = 86_400_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    cleanupRateWindows(pool).catch((err) => {
      log.error('rate window cleanup failed', { err })
      errors.captureException(err, { tags: { task: 'rate_window_cleanup' } })
    })
  }, everyMs)
  timer.unref()
  return timer
}
