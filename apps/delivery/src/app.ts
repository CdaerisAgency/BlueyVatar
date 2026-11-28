import {
  Metrics, REQUEST_ID_HEADER, requestIdFrom, statusClass, type ErrorTracker, type Logger,
} from '@blueyvatar/core'
import type { SiteSettings } from '@blueyvatar/core/settings'
import { Hono, type Context } from 'hono'
import type { UsageAlerts } from './alerts.js'
import { createCtx } from './context.js'
import { errorBody } from './errors.js'
import type { LicenseStore, RateLimiter } from './licenses.js'
import { originLock } from './origin.js'
import type { Resizer } from './resize.js'
import type { AvatarResolver } from './resolver.js'
import { mountAvatar } from './routes/avatar.js'
import { mountDefault } from './routes/default.js'
import { mountGo } from './routes/go.js'
import { mountImg } from './routes/img.js'
import { mountProfile } from './routes/profile.js'
import { mountQr } from './routes/qr.js'
import { mountService } from './routes/service.js'
import { mountUsage } from './routes/usage.js'
import type { IndexStore } from './store.js'
import type { UsageMeter } from './usage.js'

export interface AppDeps {
  /** Live admin settings (limits, image sizes, profile access). Backed by a SettingsCache refreshed every 60 s. */
  settings: { current(): SiteSettings }
  index: IndexStore
  resolver: AvatarResolver
  licenses: LicenseStore
  limiter: RateLimiter
  usage: UsageMeter
  /** Fires usage alerts at 80 and 100 percent of included volume. */
  alerts?: UsageAlerts
  resize: Resizer
  defaultUrlAllowlist: readonly string[]
  /** Origin of the profile pages the QR code points to. Defaults to https://blueyvatar.com. */
  profileBaseUrl?: string
  /** Public origin of this service, used for absolute avatar URLs in exports. Defaults to the origin of the request. */
  publicUrl?: string
  /** Bytes of the blueyvatar logo (PNG or JPEG) for QR codes with center=logo. Defaults to apps/web/public/logo.jpg. */
  qrLogo?: Uint8Array
  /** Read the client IP from CF-Connecting-IP. Only set when Cloudflare fronts the origin. */
  trustCloudflare: boolean
  remoteAddress?: (c: Context) => string | undefined
  /** When set, every request except GET /healthz must carry a matching x-origin-auth header. */
  originSecret?: string
  /**
   * Shared secret for the indexer's cache warmer (WARM_SECRET). A request to /img carrying it in
   * x-warm-auth is served normally but writes no usage meters (spec section 12). Without it the
   * header is ignored.
   */
  warmSecret?: string
  /** HMAC secret for /img paths (IMG_SIGNING_SECRET). The redirect routes sign, /img verifies. */
  imgSigningSecret: string
  /** PLUS_DIDS comma list: manual Plus grants (spec section 11.2). Gallery images ship in profile JSON for these DIDs and for DIDs with a Plus subscription. */
  plusDids?: string
  /** Clock for the restricted-scope day bucket. Tests override it. */
  now?: () => number
  /** Structured logger. Defaults to a silent one so tests stay quiet. */
  logger?: Logger
  /** Counters and timings behind GET /metrics. */
  metrics?: Metrics
  /** Error reporter (SENTRY_DSN). Unset or disabled means unhandled errors are only logged. */
  errors?: ErrorTracker
  /** Readiness probe for GET /readyz: resolves when dependencies answer, rejects otherwise. Absent means ready. */
  ready?: () => Promise<void>
  /** Time budget for the readiness probe in milliseconds. Defaults to 2000. */
  readyTimeoutMs?: number
  /** Bearer token for GET /metrics. Without it the route answers 404. */
  metricsToken?: string
}

export function createApp(deps: AppDeps) {
  const app = new Hono()
  const ctx = createCtx(deps)
  const { logger, metrics } = ctx

  // Request id first, so every response, including origin lock rejections and errors, carries it.
  app.use('*', async (c, next) => {
    const id = requestIdFrom(c.req.header(REQUEST_ID_HEADER))
    c.set('requestId' as never, id as never)
    c.header(REQUEST_ID_HEADER, id)
    const started = performance.now()
    await next()
    c.header(REQUEST_ID_HEADER, id)
    const ms = performance.now() - started
    const route = c.req.routePath === '/*' || !c.req.routePath ? 'unmatched' : c.req.routePath
    const status = c.res.status
    metrics.inc('delivery_http_requests_total', { route, status: statusClass(status) })
    metrics.observe('delivery_http_request_duration_ms', ms, { route })
    // Route pattern only: no path parameters, query, or IP, so no handle, DID, hash, or token is logged.
    logger.info('request', { requestId: id, method: c.req.method, route, status, ms: Math.round(ms) })
  })

  // Image responses never set cookies, and nothing here does (spec section 14.1).
  app.use('*', async (c, next) => {
    await next()
    c.header('x-content-type-options', 'nosniff')
  })

  if (deps.originSecret) app.use('*', originLock(deps.originSecret))

  app.onError((err, c) => {
    const requestId = c.get('requestId' as never) as string | undefined
    logger.error('unhandled error', { requestId, method: c.req.method, route: c.req.routePath, err })
    deps.errors?.captureException(err, { requestId, method: c.req.method, url: c.req.url, headers: c.req.raw.headers })
    c.header(REQUEST_ID_HEADER, requestId ?? '')
    return c.json(errorBody('internal', 'Internal server error', requestId), 500)
  })

  // Liveness: the process answers. Readiness: Postgres answers within the time budget.
  mountService(app, ctx)
  mountUsage(app, ctx)
  mountAvatar(app, ctx)
  mountProfile(app, ctx)
  mountQr(app, ctx)
  mountGo(app, ctx)
  mountImg(app, ctx)
  mountDefault(app, ctx)

  return app
}
