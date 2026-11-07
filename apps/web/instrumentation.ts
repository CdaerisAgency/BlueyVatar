import type { Instrumentation } from 'next'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertTokenKey } = await import('./lib/token-crypto')
    assertTokenKey()
  }
}

/**
 * Sends server errors to the Sentry-compatible tracker (SENTRY_DSN; a no-op when unset). The tracker
 * scrubs Authorization, x-api-key, token, and cookie values and any query secret before it sends.
 * See docs/deploy.md, "Observability".
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { errors, log } = await import('./lib/obs')
  const requestId = typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'] : undefined
  log.error('request error', { requestId, method: request.method, path: request.path.split('?')[0], routePath: context.routePath, routeType: context.routeType, err })
  errors.captureException(err, {
    requestId,
    method: request.method,
    url: request.path,
    headers: request.headers,
    tags: { route_type: context.routeType, router_kind: context.routerKind },
    extra: { digest: typeof err === 'object' && err !== null && 'digest' in err ? String((err as { digest: unknown }).digest) : undefined },
  })
  await errors.flush()
}
