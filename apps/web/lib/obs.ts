import { Metrics, createErrorTracker, createLogger, type ErrorContext, type ErrorTracker, type Logger } from '@blueyvatar/core'

/**
 * Process-wide logger, metrics, and error tracker for web. SENTRY_DSN unset means the tracker does
 * nothing. Next can load this module in more than one bundle, so the instances live on globalThis.
 */
interface Obs { log: Logger; metrics: Metrics; errors: ErrorTracker }
const g = globalThis as { __bvObs?: Obs }

function create(): Obs {
  const metrics = new Metrics()
  metrics.describe('web_stripe_webhook_total', 'Stripe webhook outcomes by result')
  return {
    log: createLogger({ app: 'web' }),
    metrics,
    errors: createErrorTracker({
      dsn: process.env.SENTRY_DSN,
      app: 'web',
      release: process.env.SENTRY_RELEASE ?? process.env.FLY_IMAGE_REF,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.FLY_APP_NAME,
    }),
  }
}

const obs = (g.__bvObs ??= create())
export const log = obs.log
export const metrics = obs.metrics
export const errors = obs.errors

/** Logs an error with a fixed message and sends it to the error tracker. Never throws. */
export function reportError(msg: string, err: unknown, ctx: ErrorContext = {}): void {
  log.error(msg, { err, ...(ctx.requestId ? { requestId: ctx.requestId } : {}) })
  errors.captureException(err, { ...ctx, tags: { task: msg.replace(/\s+/g, '_').slice(0, 60), ...(ctx.tags ?? {}) } })
}
