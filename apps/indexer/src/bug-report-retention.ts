import type pg from 'pg'
import { job, type JobFactory } from './jobs/schedule.js'

/** Bug report screenshots are kept this long (issue #266, owner decision). Web reads the same number as SCREENSHOT_RETENTION_DAYS. */
const SCREENSHOT_RETENTION_DAYS = 90

/** Deletes screenshots older than 90 days. Returns how many rows went. */
export async function purgeExpiredScreenshots(pool: Pick<pg.Pool, 'query'>, now: Date = new Date()): Promise<number> {
  const r = await pool.query(`DELETE FROM bug_report_screenshots WHERE created_at < $1::timestamptz - make_interval(days => ${SCREENSHOT_RETENTION_DAYS})`, [now])
  return r.rowCount ?? 0
}

/** Deletes bug report screenshots 90 days after they were filed (issue #266). Runs now and then daily. */
export const screenshotPurgeJob: JobFactory = (pool) => job({
  name: 'bug_report_screenshot_purge', everyMs: 24 * 60 * 60 * 1000, run: () => purgeExpiredScreenshots(pool),
  summarize: (n) => n > 0 && { deleted: n },
})
