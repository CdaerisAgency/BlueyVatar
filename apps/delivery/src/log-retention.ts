import type pg from 'pg'

/** Published retention window. The owner decision is 90 days, so a larger configured value is clamped to it. */
export const MAX_RETENTION_DAYS = 90
/** Default size cap per log store, in GB. See docs/deploy.md, "Log retention", for the sizing. */
export const DEFAULT_MAX_GB = 5

export interface RetentionConfig { days: number; maxBytes: number }

function positive(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Reads LOG_RETENTION_DAYS (default and ceiling 90) and LOG_RETENTION_MAX_GB (default 5). Invalid values fall back to the defaults. */
export function retentionConfig(env: Record<string, string | undefined> = process.env): RetentionConfig {
  const days = Math.min(positive(env.LOG_RETENTION_DAYS) ?? MAX_RETENTION_DAYS, MAX_RETENTION_DAYS)
  const gb = positive(env.LOG_RETENTION_MAX_GB) ?? DEFAULT_MAX_GB
  return { days, maxBytes: Math.floor(gb * 1024 ** 3) }
}

export interface RetentionResult { expiredEvents: number; expiredIpHashes: number; expiredViewDays: number; trimmedEvents: number; trimmedIpHashes: number; trimmedViewDays: number }

const BATCH = 1000

/** Live bytes held by database logs: processed Stripe event rows, the IP hashes still kept on reports, and daily profile view counters. */
export async function logBytes(pool: pg.Pool): Promise<number> {
  const res = await pool.query(`SELECT
    COALESCE((SELECT sum(pg_column_size(e.*)) FROM stripe_events e), 0)
    + COALESCE((SELECT sum(pg_column_size(r.ip_hash)) FROM reports r WHERE r.ip_hash IS NOT NULL), 0)
    + COALESCE((SELECT sum(pg_column_size(v.*)) FROM profile_view_counters v), 0) AS bytes`)
  return Number(res.rows[0].bytes)
}

/**
 * Applies the retention policy to logs held in Postgres. First the age limit: Stripe event ids and report IP hashes
 * older than `days` are removed (the report row stays, with ip_hash cleared), as are daily profile view counters from days before the window. Then the size cap: while the live bytes
 * exceed `maxBytes`, the oldest rows go first, whichever table holds them. Safe to run from several replicas at once.
 */
export async function enforceLogRetention(pool: pg.Pool, cfg: RetentionConfig = retentionConfig()): Promise<RetentionResult> {
  const out: RetentionResult = { expiredEvents: 0, expiredIpHashes: 0, expiredViewDays: 0, trimmedEvents: 0, trimmedIpHashes: 0, trimmedViewDays: 0 }
  const age = `now() - ($1 * interval '1 day')`
  out.expiredEvents = (await pool.query(`DELETE FROM stripe_events WHERE processed_at < ${age}`, [cfg.days])).rowCount ?? 0
  out.expiredIpHashes = (await pool.query(`UPDATE reports SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at < ${age}`, [cfg.days])).rowCount ?? 0
  out.expiredViewDays = (await pool.query(`DELETE FROM profile_view_counters WHERE day < (now() AT TIME ZONE 'UTC')::date - $1::int`, [Math.floor(cfg.days)])).rowCount ?? 0

  while ((await logBytes(pool)) > cfg.maxBytes) {
    const oldest = await pool.query(`SELECT
      (SELECT min(processed_at) FROM stripe_events) AS event_at,
      (SELECT min(created_at) FROM reports WHERE ip_hash IS NOT NULL) AS report_at,
      (SELECT min(day)::timestamptz FROM profile_view_counters) AS view_at`)
    const { event_at: eventAt, report_at: reportAt, view_at: viewAt } = oldest.rows[0] as { event_at: Date | null; report_at: Date | null; view_at: Date | null }
    if (!eventAt && !reportAt && !viewAt) break
    const first = Math.min(...[eventAt, reportAt, viewAt].filter((d): d is Date => d !== null).map((d) => d.getTime()))
    if (eventAt && eventAt.getTime() === first) {
      out.trimmedEvents += (await pool.query('DELETE FROM stripe_events WHERE event_id IN (SELECT event_id FROM stripe_events ORDER BY processed_at LIMIT $1)', [BATCH])).rowCount ?? 0
    } else if (reportAt && reportAt.getTime() === first) {
      out.trimmedIpHashes += (await pool.query('UPDATE reports SET ip_hash = NULL WHERE id IN (SELECT id FROM reports WHERE ip_hash IS NOT NULL ORDER BY created_at LIMIT $1)', [BATCH])).rowCount ?? 0
    } else {
      out.trimmedViewDays += (await pool.query('DELETE FROM profile_view_counters WHERE (did, day) IN (SELECT did, day FROM profile_view_counters ORDER BY day LIMIT $1)', [BATCH])).rowCount ?? 0
    }
  }
  return out
}

/** Runs the purge shortly after start and then daily. Failures are logged and retried on the next tick. */
export function scheduleLogRetention(pool: pg.Pool, everyMs = 86_400_000, cfg: RetentionConfig = retentionConfig()): NodeJS.Timeout {
  const run = () => enforceLogRetention(pool, cfg).then(
    (r) => { if (r.expiredEvents + r.expiredIpHashes + r.expiredViewDays + r.trimmedEvents + r.trimmedIpHashes + r.trimmedViewDays > 0) console.info('log retention purge', r) },
    (err) => console.error('log retention purge failed', err),
  )
  setTimeout(run, 60_000).unref()
  const timer = setInterval(run, everyMs)
  timer.unref()
  return timer
}
