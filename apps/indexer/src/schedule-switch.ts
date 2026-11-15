import { tickJob } from './jobs/tick-job.js'

/**
 * Avatar calendar switch (issue #219). Finds accounts whose next_change_at has passed and asks the web app to change
 * the default image when an entry starts or ends. The step there claims the row with a short lease. Reuses
 * EFFECTS_TICK_SECRET, so no new secret is needed.
 */
export const scheduleSwitch = tickJob({
  name: 'schedule_switch',
  batch: 25,
  path: '/account/avatars/schedule/tick',
  timeoutMs: 60_000,
  refused: 'schedule tick refused',
  off: 'EFFECTS_TICK_SECRET is not set; the avatar calendar switch is off',
  sql: 'SELECT did FROM avatar_schedule WHERE next_change_at IS NOT NULL AND next_change_at <= $1 ORDER BY next_change_at LIMIT $2',
})
