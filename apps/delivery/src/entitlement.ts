import { ANONYMOUS_DAILY_LIMIT, ENTITLEMENTS, type Tier } from '@blueyvatar/core'
import type { ErrorCode } from './errors.js'
import { hostAllowed, type LicenseStore, type RateLimiter, type RateWindow } from './licenses.js'

export interface RequestInfo {
  headerKey: string | undefined
  tokenParam: string | undefined
  origin: string | undefined
  referer: string | undefined
  clientIp: string
}

export type EntitlementResult =
  | { ok: true; tier: Tier; licenseId: string | null; /** Null for anonymous callers. */ keyKind: 'secret' | 'publishable' | null; window: RateWindow }
  | { ok: false; status: number; code: ErrorCode; message: string; window?: RateWindow }

function requestHost(info: RequestInfo): string | null {
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

/** Steps 1 to 4 of the request pipeline in spec section 12. */
export async function checkEntitlement(
  info: RequestInfo,
  licenses: LicenseStore,
  limiter: RateLimiter,
): Promise<EntitlementResult> {
  const raw = info.headerKey ?? info.tokenParam
  if (!raw) {
    const window = await limiter.hit(`ip:${info.clientIp}`, ANONYMOUS_DAILY_LIMIT, 86400)
    if (window.exceeded) {
      return { ok: false, status: 429, code: 'rate_limited', message: 'Anonymous daily limit reached', window }
    }
    return { ok: true, tier: 'free', licenseId: null, keyKind: null, window }
  }

  const found = await licenses.findKey(raw)
  if (!found) return { ok: false, status: 401, code: 'invalid_key', message: 'Unknown API key' }
  const { key, license } = found
  // Past due is served: the store already drops the tier to Free once the grace period ends.
  if (license.status !== 'active' && license.status !== 'past_due') {
    return { ok: false, status: 402, code: 'license_inactive', message: `License is ${license.status}` }
  }
  if (key.kind === 'publishable' && info.headerKey === undefined && key.domains.length > 0) {
    const host = requestHost(info)
    if (!host || !hostAllowed(host, key.domains)) {
      return { ok: false, status: 403, code: 'origin_not_allowed', message: 'Origin is not on this key\'s domain list' }
    }
  }
  if (key.kind === 'secret' && info.headerKey === undefined) {
    return { ok: false, status: 401, code: 'invalid_key', message: 'Secret keys must be sent in the x-api-key header' }
  }

  const ent = ENTITLEMENTS[license.tier]
  const window = ent.keyedDaily !== null
    ? await limiter.hit(`lic:${license.licenseId}:d`, ent.keyedDaily, 86400)
    : ent.keyedMonthly !== null
      ? await limiter.hit(`lic:${license.licenseId}:m`, ent.keyedMonthly, 30 * 86400)
      : { limit: 0, remaining: 0, reset: 0, exceeded: false }
  if (ent.overage === 'blocked' && window.exceeded) {
    return { ok: false, status: 429, code: 'rate_limited', message: 'Included volume reached', window }
  }
  return { ok: true, tier: license.tier, licenseId: license.licenseId, keyKind: key.kind, window }
}

