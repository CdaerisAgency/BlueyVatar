import { createLogger, restrictedScope, imagePath, Metrics, type ImageFormat, type Logger, type parseIdentifier } from '@blueyvatar/core'
import type { Context } from 'hono'
import type { AppDeps } from './app.js'
import { checkEntitlement, type EntitlementResult } from './entitlement.js'
import { fail, isCrossOriginRequest, originHost, rateHeaders } from './http.js'
import { hostAllowed } from './licenses.js'
import type { Identity } from './resolver.js'
import type { Visibility } from './store.js'

export type Ok = Extract<EntitlementResult, { ok: true }>
export type ParsedId = NonNullable<ReturnType<typeof parseIdentifier>>

export const DEFAULT_PROFILE_BASE_URL = 'https://blueyvatar.com'

export function isRestricted(v: Visibility): boolean {
  return v.keyedOnly || v.domainAllowlist.length > 0
}

/** Everything a route needs, built once in createApp. */
export interface Ctx {
  deps: AppDeps
  logger: Logger
  metrics: Metrics
  /** deps.profileBaseUrl (or the default) with trailing slashes removed. */
  profileBase: string
  clientIp: (c: Context) => string
  entitle: (c: Context, metered?: boolean) => Promise<EntitlementResult>
  isCrossOrigin: (c: Context) => boolean
  /** The visibility rules when this caller may fetch the avatar (spec section 10.2), else null. */
  visibilityAllows: (c: Context, did: string, e: Ok) => Promise<Visibility | null>
  signedPath: (c: Context, e: Ok, v: Visibility, did: string, cid: string, size: number, format: ImageFormat, quality?: number) => string
  findIdentity: (id: ParsedId) => Promise<Identity | null>
}

export function createCtx(deps: AppDeps): Ctx {
  const logger = deps.logger ?? createLogger({ app: 'delivery', write: () => {} })
  const metrics = deps.metrics ?? new Metrics()
  const profileBase = (deps.profileBaseUrl ?? DEFAULT_PROFILE_BASE_URL).replace(/\/+$/, '')
  const profileHost = new URL(profileBase).host

  const clientIp = (c: Context) =>
    (deps.trustCloudflare ? c.req.header('cf-connecting-ip') : undefined)
    ?? deps.remoteAddress?.(c)
    ?? 'unknown'

  async function entitle(c: Context, metered = true) {
    const e = await checkEntitlement(
      {
        headerKey: c.req.header('x-api-key'),
        tokenParam: c.req.query('token'),
        origin: c.req.header('origin'),
        referer: c.req.header('referer'),
        clientIp: clientIp(c),
      },
      deps.licenses,
      deps.limiter,
    )
    rateHeaders(c, e, metered)
    if (!e.ok && e.status === 429) metrics.inc('delivery_rate_limit_rejections_total')
    if (!e.ok && e.status === 429 && e.window) {
      c.header('retry-after', String(Math.max(1, e.window.reset - Math.floor(Date.now() / 1000))))
    }
    return e
  }

  function isCrossOrigin(c: Context): boolean {
    return isCrossOriginRequest(c.req.header('origin'), [new URL(c.req.url).host, profileHost])
  }

  async function visibilityAllows(c: Context, did: string, e: Ok): Promise<Visibility | null> {
    const v = await deps.index.visibility(did)
    if (v.keyedOnly && !e.licenseId) return null
    if (v.domainAllowlist.length > 0) {
      const host = originHost(c)
      if (!host || !hostAllowed(host, v.domainAllowlist)) return null
    }
    return v
  }

  // Signed /img path for this caller (issues #68 and #72). Public avatars get an empty scope, so
  // the URL is the same for everyone and the CDN caches it once. Restricted avatars carry the
  // key id or the allowed origin host plus a day bucket, so they cache per caller per day and a
  // leaked URL dies by the end of the next day. The size and format are signed, so a caller
  // only gets the sizes the redirect route granted under its tier.
  function signedPath(c: Context, e: Ok, v: Visibility, did: string, cid: string, size: number, format: ImageFormat, quality?: number) {
    const scope = isRestricted(v)
      ? restrictedScope(e.licenseId ? `k:${e.licenseId}` : `d:${originHost(c) ?? ''}`, deps.now?.())
      : ''
    return imagePath(deps.imgSigningSecret, did, cid, size, format, quality, scope)
  }

  async function findIdentity(id: ParsedId): Promise<Identity | null> {
    if (id.kind === 'hash') {
      const did = await deps.index.didForEmailHash(id.value)
      return did ? await deps.resolver.resolveIdentity({ kind: 'did', value: did }) : null
    }
    return deps.resolver.resolveIdentity(id)
  }

  return { deps, logger, metrics, profileBase, clientIp, entitle, isCrossOrigin, visibilityAllows, signedPath, findIdentity }
}

export type GateResult<I extends Identity = Identity> =
  | { ok: true; identity: I; vis: Visibility }
  | { ok: false; res: ReturnType<typeof fail> }

/**
 * The checks every profile-shaped route runs after resolving an identity: it exists (and has a
 * handle when `requireHandle`), its repo is active, the profile is not hidden, and, unless
 * `visibility` is false, this caller passes the visibility rules. A miss and a hidden profile
 * answer 404. A restricted profile answers 403 for a handle or DID and 404 for a hash, so a hash
 * lookup cannot tell a restricted profile from an unlinked one.
 */
export type HandledIdentity = Identity & { handle: string }

export async function gateProfile(
  c: Context, ctx: Ctx, id: ParsedId, e: Ok, identity: Identity | null,
  opts: { requireHandle: true; visibility?: boolean },
): Promise<GateResult<HandledIdentity>>
export async function gateProfile(
  c: Context, ctx: Ctx, id: ParsedId, e: Ok, identity: Identity | null,
  opts?: { requireHandle?: boolean; visibility?: boolean },
): Promise<GateResult>
export async function gateProfile(
  c: Context,
  ctx: Ctx,
  id: ParsedId,
  e: Ok,
  identity: Identity | null,
  opts: { requireHandle?: boolean; visibility?: boolean } = {},
): Promise<GateResult> {
  const { deps } = ctx
  const miss = { ok: false, res: fail(c, 404, 'not_found', 'No profile') } as const
  if (!identity || (opts.requireHandle && !identity.handle) || !(await deps.index.isRepoActive(identity.did))) return miss
  const vis = await deps.index.visibility(identity.did)
  if (vis.hiddenProfile) return miss
  if (opts.visibility !== false && !(await ctx.visibilityAllows(c, identity.did, e))) {
    return id.kind === 'hash' ? miss : { ok: false, res: fail(c, 403, 'access_denied', 'Profile not available to this caller') }
  }
  return { ok: true, identity: identity as HandledIdentity, vis }
}
