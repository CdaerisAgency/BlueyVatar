import type pg from 'pg'
import { errors, log } from './obs.js'

type Env = Record<string, string | undefined>
type Fetch = typeof fetch

/** At most this many accounts per run, so a burst of windows that start at the same midnight spreads over a few runs. */
export const EFFECTS_BATCH = 25

export type EffectsRun = { due: number; called: number; failed: number }

/**
 * Out-of-office switch-on and switch-off (issue #283). Finds accounts whose window has started (state scheduled) or
 * ended (state active) and asks the web app to do the step, one POST per account. The web app does the work because
 * only it holds the OAuth keys that write to a user's repository; the step there re-checks that it is due, so a
 * repeat call is harmless. A failed switch-off waits for away_retry_at before it is picked again. Off when
 * EFFECTS_TICK_SECRET is not set.
 */
export async function runEffectsSwitch(pool: pg.Pool, env: Env = process.env, f: Fetch = fetch, now: Date = new Date()): Promise<EffectsRun> {
  const out: EffectsRun = { due: 0, called: 0, failed: 0 }
  const secret = env.EFFECTS_TICK_SECRET
  if (!secret) return out
  const base = (env.PUBLIC_URL ?? 'https://blueyvatar.com').replace(/\/$/, '')
  const { rows } = await pool.query<{ did: string }>(
    `SELECT did FROM avatar_effects
      WHERE ((away_state = 'scheduled' AND away_start_at <= $1) OR (away_state = 'active' AND away_end_at <= $1))
        AND (away_retry_at IS NULL OR away_retry_at <= $1)
      ORDER BY LEAST(away_start_at, away_end_at) LIMIT $2`,
    [now, EFFECTS_BATCH],
  )
  out.due = rows.length
  for (const { did } of rows) {
    try {
      const res = await f(`${base}/account/effects/tick`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ did }),
        signal: AbortSignal.timeout(30_000),
      })
      if (res.ok) out.called++
      else {
        out.failed++
        log.warn('effects tick refused', { status: res.status })
      }
    } catch (err) {
      out.failed++
      errors.captureException(err, { tags: { task: 'effects_switch' } })
    }
  }
  return out
}

/** Checks every minute. The query is one indexed scan, so it is cheap when nothing is due. */
export function scheduleEffectsSwitch(pool: pg.Pool, env: Env = process.env, everyMs = 60_000): NodeJS.Timeout | null {
  if (!env.EFFECTS_TICK_SECRET) {
    log.info('EFFECTS_TICK_SECRET is not set; out-of-office switching is off')
    return null
  }
  const run = () =>
    void runEffectsSwitch(pool, env)
      .then((r) => { if (r.due) log.info('effects switch', r) })
      .catch((err) => {
        log.error('effects switch failed', { err })
        errors.captureException(err, { tags: { task: 'effects_switch' } })
      })
  run()
  const timer = setInterval(run, everyMs)
  timer.unref()
  return timer
}
