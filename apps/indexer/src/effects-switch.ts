import { tickJob } from './jobs/tick-job.js'

/**
 * Out-of-office switch-on and switch-off (issue #283). Finds accounts whose window has started (state scheduled) or
 * ended (state active) and asks the web app to do the step. A failed switch-off waits for away_retry_at before it is
 * picked again.
 */
export const effectsSwitch = tickJob({
  name: 'effects_switch',
  batch: 25,
  path: '/account/effects/tick',
  timeoutMs: 30_000,
  refused: 'effects tick refused',
  off: 'EFFECTS_TICK_SECRET is not set; out-of-office switching is off',
  sql: `SELECT did FROM avatar_effects
      WHERE ((away_state = 'scheduled' AND away_start_at <= $1) OR (away_state = 'active' AND away_end_at <= $1))
        AND (away_retry_at IS NULL OR away_retry_at <= $1)
      ORDER BY LEAST(away_start_at, away_end_at) LIMIT $2`,
})
