import type pg from 'pg'
import { errors, log } from '../obs.js'
import { publicUrl } from '../public-url.js'
import { job as defineJob, type JobDef } from './schedule.js'

type Env = Record<string, string | undefined>
type Fetch = typeof fetch

type TickRun = { due: number; called: number; failed: number }

type TickConfig = {
  /** Error-tracker tag and log text (underscores as spaces). */
  name: string
  /** Selects `did` rows that are due. Takes `$1` = now and `$2` = batch. */
  sql: string
  /** At most this many accounts per run, so a burst that starts at the same midnight spreads over a few runs. */
  batch: number
  /** Route on the web app that does the step for one account. */
  path: string
  timeoutMs: number
  /** Log text when the web app answers with an error status. */
  refused: string
  /** Log text when EFFECTS_TICK_SECRET is not set. */
  off: string
  everyMs?: number
}

/**
 * A job that finds due accounts and asks the web app to do a step for each, one POST per account. The web app does the
 * work because only it holds the OAuth keys that write to a user's repository; each step re-checks that it is due, so a
 * repeat call is harmless. Off when EFFECTS_TICK_SECRET is not set. Checks every minute (default): the query is one
 * indexed scan, so it is cheap when nothing is due.
 */
export function tickJob(cfg: TickConfig) {
  async function run(pool: pg.Pool, env: Env = process.env, f: Fetch = fetch, now: Date = new Date()): Promise<TickRun> {
    const out: TickRun = { due: 0, called: 0, failed: 0 }
    const secret = env.EFFECTS_TICK_SECRET
    if (!secret) return out
    const base = publicUrl(env).replace(/\/$/, '')
    const { rows } = await pool.query<{ did: string }>(cfg.sql, [now, cfg.batch])
    out.due = rows.length
    for (const { did } of rows) {
      try {
        const res = await f(`${base}${cfg.path}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
          body: JSON.stringify({ did }),
          signal: AbortSignal.timeout(cfg.timeoutMs),
        })
        if (res.ok) out.called++
        else {
          out.failed++
          log.warn(cfg.refused, { status: res.status })
        }
      } catch (err) {
        out.failed++
        errors.captureException(err, { tags: { task: cfg.name } })
      }
    }
    return out
  }
  const job = (pool: pg.Pool, env: Env = process.env): JobDef | null => {
    if (!env.EFFECTS_TICK_SECRET) {
      log.info(cfg.off)
      return null
    }
    return defineJob({ name: cfg.name, everyMs: cfg.everyMs ?? 60_000, run: () => run(pool, env), summarize: (r) => r.due && r })
  }
  return { ...cfg, run, job }
}
