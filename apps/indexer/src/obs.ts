import { Metrics, createErrorTracker, createLogger } from '@blueyvatar/core'

/** Process-wide logger, metrics, and error tracker for the indexer. SENTRY_DSN unset means the tracker does nothing. */
export const log = createLogger({ app: 'indexer' })
export const metrics = new Metrics()
export const errors = createErrorTracker({
  dsn: process.env.SENTRY_DSN,
  app: 'indexer',
  release: process.env.SENTRY_RELEASE ?? process.env.FLY_IMAGE_REF,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.FLY_APP_NAME,
})

metrics.describe('indexer_events_total', 'Tap events processed, by type and result')
metrics.describe('indexer_last_event_age_seconds', 'Seconds since the last Tap event was processed (since start when none yet)')
metrics.describe('indexer_last_heartbeat_age_seconds', 'Seconds since Tap last answered the health probe (since start when none yet)')
metrics.describe('indexer_last_event_id', 'Id of the last Tap event processed (the consumer cursor)')
metrics.describe('indexer_tap_outbox_buffer', 'Events waiting in the Tap outbox, a measure of cursor lag')
metrics.describe('indexer_ready', '1 when the indexer is ready, 0 when it has stalled')
metrics.describe('indexer_postgres_errors_total', 'Postgres pool errors')
