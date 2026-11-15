import type pg from 'pg'
import { errors, log } from './obs.js'

type Env = Record<string, string | undefined>
type Fetch = typeof fetch

/** At most this many accounts per run, so a burst of calendars that change at the same midnight spreads over a few runs. */
export const SCHEDULE_BATCH = 25

export type ScheduleRun = { due: number; called: number; failed: number }

/**
 * Avatar calendar switch (issue #219). Finds accounts whose next_change_at has passed and asks the web app to do the
 * step, one POST per account. The web app does the work because only it holds the OAuth keys that write to a user's
 * repository; the step there claims the row with a short lease and re-checks that it is due, so a repeat call is
 * harmless. Reuses EFFECTS_TICK_SECRET, so no new secret is needed. Off when it is not set.
 */
export async function runScheduleSwitch(pool: pg.Pool, env: Env = process.env, f: Fetch = fetch, now: Date = new Date()): Promise<ScheduleRun> {
  const out: ScheduleRun = { due: 0, called: 0, failed: 0 }
  const secret = env.EFFECTS_TICK_SECRET
  if (!secret) return out
  const base = (env.PUBLIC_URL ?? 'https://blueyvatar.com').replace(/\/$/, '')
  const { rows } = await pool.query<{ did: string }>(
    'SELECT did FROM avatar_schedule WHERE next_change_at IS NOT NULL AND next_change_at <= $1 ORDER BY next_change_at LIMIT $2',
    [now, SCHEDULE_BATCH],
  )
  out.due = rows.length
  for (const { did } of rows) {
    try {
      const res = await f(`${base}/account/avatars/schedule/tick`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ did }),
        signal: AbortSignal.timeout(60_000),
      })
      if (res.ok) out.called++
      else {
        out.failed++
        log.warn('schedule tick refused', { status: res.status })
      }
    } catch (err) {
      out.failed++
      errors.captureException(err, { tags: { task: 'schedule_switch' } })
    }
  }
  return out
}

/** Checks every minute. The query is one indexed scan, so it is cheap when nothing is due. */
export function scheduleScheduleSwitch(pool: pg.Pool, env: Env = process.env, everyMs = 60_000): NodeJS.Timeout | null {
  if (!env.EFFECTS_TICK_SECRET) {
    log.info('EFFECTS_TICK_SECRET is not set; the avatar calendar switch is off')
    return null
  }
  const run = () =>
    void runScheduleSwitch(pool, env)
      .then((r) => { if (r.due) log.info('schedule switch', r) })
      .catch((err) => {
        log.error('schedule switch failed', { err })
        errors.captureException(err, { tags: { task: 'schedule_switch' } })
      })
  run()
  const timer = setInterval(run, everyMs)
  timer.unref()
  return timer
}
