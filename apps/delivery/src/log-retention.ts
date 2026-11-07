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

export interface RetentionResult { expiredEvents: number; expiredIpHashes: number; trimmedEvents: number; trimmedIpHashes: number }

const BATCH = 1000

/** Live bytes held by database logs: processed Stripe event rows plus the IP hashes still kept on reports. */
export async function logBytes(pool: pg.Pool): Promise<number> {
  const res = await pool.query(`SELECT
    COALESCE((SELECT sum(pg_column_size(e.*)) FROM stripe_events e), 0)
    + COALESCE((SELECT sum(pg_column_size(r.ip_hash)) FROM reports r WHERE r.ip_hash IS NOT NULL), 0) AS bytes`)
  return Number(res.rows[0].bytes)
}

/**
 * Applies the retention policy to logs held in Postgres. First the age limit: Stripe event ids and report IP hashes
 * older than `days` are removed (the report row stays, with ip_hash cleared). Then the size cap: while the live bytes
 * exceed `maxBytes`, the oldest rows go first, whichever table holds them. Safe to run from several replicas at once.
 */
export async function enforceLogRetention(pool: pg.Pool, cfg: RetentionConfig = retentionConfig()): Promise<RetentionResult> {
  const out: RetentionResult = { expiredEvents: 0, expiredIpHashes: 0, trimmedEvents: 0, trimmedIpHashes: 0 }
  const age = `now() - ($1 * interval '1 day')`
  out.expiredEvents = (await pool.query(`DELETE FROM stripe_events WHERE processed_at < ${age}`, [cfg.days])).rowCount ?? 0
  out.expiredIpHashes = (await pool.query(`UPDATE reports SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at < ${age}`, [cfg.days])).rowCount ?? 0

  while ((await logBytes(pool)) > cfg.maxBytes) {
    const oldest = await pool.query(`SELECT
      (SELECT min(processed_at) FROM stripe_events) AS event_at,
      (SELECT min(created_at) FROM reports WHERE ip_hash IS NOT NULL) AS report_at`)
    const { event_at: eventAt, report_at: reportAt } = oldest.rows[0] as { event_at: Date | null; report_at: Date | null }
    if (!eventAt && !reportAt) break
    if (eventAt && (!reportAt || eventAt <= reportAt)) {
      out.trimmedEvents += (await pool.query('DELETE FROM stripe_events WHERE event_id IN (SELECT event_id FROM stripe_events ORDER BY processed_at LIMIT $1)', [BATCH])).rowCount ?? 0
    } else {
      out.trimmedIpHashes += (await pool.query('UPDATE reports SET ip_hash = NULL WHERE id IN (SELECT id FROM reports WHERE ip_hash IS NOT NULL ORDER BY created_at LIMIT $1)', [BATCH])).rowCount ?? 0
    }
  }
  return out
}

/** Runs the purge shortly after start and then daily. Failures are logged and retried on the next tick. */
export function scheduleLogRetention(pool: pg.Pool, everyMs = 86_400_000, cfg: RetentionConfig = retentionConfig()): NodeJS.Timeout {
  const run = () => enforceLogRetention(pool, cfg).then(
    (r) => { if (r.expiredEvents + r.expiredIpHashes + r.trimmedEvents + r.trimmedIpHashes > 0) console.info('log retention purge', r) },
    (err) => console.error('log retention purge failed', err),
  )
  setTimeout(run, 60_000).unref()
  const timer = setInterval(run, everyMs)
  timer.unref()
  return timer
}
