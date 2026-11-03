import type pg from 'pg'

/** Deletes rate window rows whose window has ended. Returns the number removed. */
export async function cleanupRateWindows(pool: pg.Pool): Promise<number> {
  const res = await pool.query('DELETE FROM rate_windows WHERE reset_at <= now()')
  return res.rowCount ?? 0
}

/** Runs the cleanup on an interval (default hourly). Failures are logged and retried on the next tick. */
export function scheduleRateWindowCleanup(pool: pg.Pool, everyMs = 3_600_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    cleanupRateWindows(pool).catch((err) => console.error('rate window cleanup failed', err))
  }, everyMs)
  timer.unref()
  return timer
}
