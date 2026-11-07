import { createHash, timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { errorBody } from './errors.js'

export const ORIGIN_AUTH_HEADER = 'x-origin-auth'

function digest(s: string): Buffer {
  return createHash('sha256').update(s).digest()
}

/** Constant-time string compare. Hashing first makes the buffers equal length. */
export function secretsEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b))
}

/**
 * Rejects requests that did not pass through Cloudflare. A Cloudflare request header
 * transform rule adds `x-origin-auth` at the edge; anything without it is refused.
 * GET /healthz and GET /readyz are exempt so the platform health check keeps working.
 */
export function originLock(secret: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === 'GET' && (c.req.path === '/healthz' || c.req.path === '/readyz')) return next()
    const got = c.req.header(ORIGIN_AUTH_HEADER)
    if (!got || !secretsEqual(got, secret)) {
      return c.json(errorBody('origin_forbidden', 'Requests must come through the CDN'), 403)
    }
    return next()
  }
}

/** Startup warning for the spoofable-IP configuration. Returns the message, or null. */
export function originLockWarning(env: { ORIGIN_SECRET?: string; TRUST_CLOUDFLARE?: string }): string | null {
  if (!env.ORIGIN_SECRET && env.TRUST_CLOUDFLARE === 'true') {
    return 'TRUST_CLOUDFLARE=true but ORIGIN_SECRET is unset; CF-Connecting-IP can be spoofed by clients that reach the origin directly'
  }
  return null
}
