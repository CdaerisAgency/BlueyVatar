import { Metrics, createErrorTracker, createLogger } from '@blueyvatar/core'

/** Process-wide logger, metrics, and error tracker for delivery. SENTRY_DSN unset means the tracker does nothing. */
export const log = createLogger({ app: 'delivery' })
export const metrics = new Metrics()
export const errors = createErrorTracker({
  dsn: process.env.SENTRY_DSN,
  app: 'delivery',
  release: process.env.SENTRY_RELEASE ?? process.env.FLY_IMAGE_REF,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.FLY_APP_NAME,
})

metrics.describe('delivery_http_requests_total', 'HTTP responses by route pattern and status class')
metrics.describe('delivery_http_request_duration_ms', 'HTTP request duration in milliseconds by route pattern')
metrics.describe('delivery_resolutions_total', 'Avatar and profile resolutions by route and result')
metrics.describe('delivery_blob_cache_hits_total', 'getBlob calls served from the in-memory original cache')
metrics.describe('delivery_blob_failures_total', 'getBlob calls that failed, by outcome')
metrics.describe('delivery_transforms_total', 'Image resizes served from /img')
metrics.describe('delivery_transforms_in_flight', 'Resize workers running now')
metrics.describe('delivery_transforms_queued', 'Resize jobs waiting for a worker slot')
metrics.describe('delivery_transforms_shed_total', 'Resize jobs rejected with 503 because the queue was full or the wait ran out')
metrics.describe('delivery_rate_limit_rejections_total', 'Requests rejected with 429')
metrics.describe('delivery_postgres_errors_total', 'Postgres pool errors and failed readiness probes')
metrics.describe('delivery_readyz_failures_total', 'Failed /readyz probes')

const BLOB_OK = new Set(['ok', 'cache_hit'])

/** Turns the resolver's fixed log lines into metrics, then logs them. Called from the resolver's log hook. */
export function resolverLog(msg: string, meta?: Record<string, unknown>, m: Metrics = metrics): void {
  if (msg === 'getBlob' && typeof meta?.outcome === 'string') {
    if (meta.outcome === 'cache_hit') m.inc('delivery_blob_cache_hits_total')
    else if (!BLOB_OK.has(meta.outcome)) m.inc('delivery_blob_failures_total', { outcome: meta.outcome })
    // Successful fetches are frequent and carry no news; failures and skips are logged.
    if (BLOB_OK.has(meta.outcome)) return log.debug(msg, meta)
  }
  log.warn(msg, meta)
}
