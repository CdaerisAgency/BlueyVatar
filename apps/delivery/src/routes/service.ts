import type { Hono } from 'hono'
import type { Ctx } from '../context.js'
import { errorBody } from '../errors.js'
import { fail } from '../http.js'
import { secretsEqual } from '../origin.js'
import { openApiDocument } from '../openapi.js'

export function mountService(app: Hono, ctx: Ctx): void {
  const { deps, logger, metrics } = ctx

  // Liveness: the process answers. Readiness: Postgres answers within the time budget.
  app.get('/healthz', (c) => c.text('ok'))

  // Machine-readable API description (issue #142). Public, no key, no metering.
  app.get('/openapi.json', (c) => {
    c.header('cache-control', 'public, max-age=3600')
    return c.json(openApiDocument)
  })

  app.get('/readyz', async (c) => {
    if (deps.ready) {
      let timer: NodeJS.Timeout | undefined
      try {
        await Promise.race([
          deps.ready(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('readiness check timed out')), deps.readyTimeoutMs ?? 2000) }),
        ])
      } catch (err) {
        metrics.inc('delivery_readyz_failures_total')
        logger.error('readiness check failed', { requestId: c.get('requestId' as never), err })
        return c.json(errorBody('not_ready', 'Dependency check failed', c.get('requestId' as never) as string | undefined), 503)
      } finally {
        clearTimeout(timer)
      }
    }
    return c.json({ status: 'ready' })
  })

  // Prometheus text format. Needs a bearer token (METRICS_TOKEN); without one the route does not exist.
  app.get('/metrics', (c) => {
    const expected = deps.metricsToken
    const got = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1]
    if (!expected || !got || !secretsEqual(got, expected)) return fail(c, 404, 'not_found', 'Not found')
    return c.body(metrics.render(), 200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' })
  })

}
