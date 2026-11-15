import type pg from 'pg'

/** Bug report screenshots are kept this long (issue #266, owner decision). Web reads the same number as SCREENSHOT_RETENTION_DAYS. */
export const SCREENSHOT_RETENTION_DAYS = 90

/** Deletes screenshots older than 90 days. Returns how many rows went. */
export async function purgeExpiredScreenshots(pool: Pick<pg.Pool, 'query'>, now: Date = new Date()): Promise<number> {
  const r = await pool.query(`DELETE FROM bug_report_screenshots WHERE created_at < $1::timestamptz - make_interval(days => ${SCREENSHOT_RETENTION_DAYS})`, [now])
  return r.rowCount ?? 0
}

/** Runs the purge now and then daily. Failures are logged and retried on the next tick. */
export function scheduleScreenshotPurge(pool: Pick<pg.Pool, 'query'>, everyMs = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  const run = () =>
    purgeExpiredScreenshots(pool)
      .then((n) => n && console.log('bug report screenshot purge', JSON.stringify({ deleted: n })))
      .catch((err) => console.error('bug report screenshot purge failed', err instanceof Error ? err.message : 'unknown'))
  void run()
  const timer = setInterval(run, everyMs)
  timer.unref()
  return timer
}
