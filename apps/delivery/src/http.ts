import type { Context } from 'hono'
import { errorBody, type ErrorCode } from './errors.js'
import type { EntitlementResult } from './entitlement.js'
import type { ResizeBusyError } from './resize.js'

export function fail(c: Context, status: number, code: ErrorCode, message: string) {
  // Server errors carry the request id in the body so a user can quote it. Client errors do not:
  // hash lookups must answer byte for byte the same whether or not a link exists (issue 59).
  return c.json(errorBody(code, message, status >= 500 ? (c.get('requestId' as never) as string | undefined) : undefined), status as 400)
}

/** Shed response when the resize queue is full: 503 with Retry-After, never cached. */
export function overloaded(c: Context, err: ResizeBusyError) {
  c.header('retry-after', String(err.retryAfterSeconds))
  c.header('cache-control', 'no-store')
  return fail(c, 503, 'overloaded', 'Image processing is busy; retry shortly')
}

export function rateHeaders(c: Context, e: EntitlementResult, metered = true) {
  const w = e.window
  if (w && w.limit > 0) {
    c.header('x-rate-limit-limit', String(w.limit))
    c.header('x-rate-limit-remaining', String(w.remaining))
    c.header('x-rate-limit-reset', String(w.reset))
  }
  if (e.ok) {
    c.header('x-tier', e.tier)
    if (e.licenseId && metered) c.header('x-usage-cost', '1')
  }
}

/** Host of the Origin header, else of the Referer, else null. Malformed values are skipped. */
export function originHost(c: Context): string | null {
  return requestHost({ origin: c.req.header('origin'), referer: c.req.header('referer') })
}

/** The one implementation behind originHost and the entitlement check. */
export function requestHost(info: { origin: string | undefined; referer: string | undefined }): string | null {
  for (const v of [info.origin, info.referer]) {
    if (!v) continue
    try {
      return new URL(v).hostname
    } catch {
      /* ignore malformed header */
    }
  }
  return null
}

/** True when the request carries an Origin header that is neither this service's host nor the profile site's host. */
export function isCrossOriginRequest(origin: string | undefined, ownHosts: readonly string[]): boolean {
  if (!origin) return false
  try {
    return !ownHosts.includes(new URL(origin).host)
  } catch {
    return true
  }
}
