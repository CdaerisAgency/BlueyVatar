import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import {
  ABSOLUTE_MAX_SIZE, CANONICAL_QUALITY, GALLERY_MAX, isPlusDid, ratingAllowed, DEFAULT_STYLES, ENTITLEMENTS, IMMUTABLE_CACHE_CONTROL, ParamError, imagePath, isMd5Hex,
  isSha256Hex, parseAvatarParams, resolveProfileLinks,
  parseIdentifier, pickCandidate, qrSvg, restrictedScope, scopeExpired, verifyImageSig, type AvatarParams, type DefaultStyle,
  type ImageFormat, WARM_HEADER,
} from '@blueyvatar/core'
import { checkEntitlement, type EntitlementResult } from './entitlement.js'
import { errorBody, type ErrorCode } from './errors.js'
import type { UsageAlerts } from './alerts.js'
import { cleanInitials, defaultSvg, initialsFromName } from './defaults.js'
import { hostAllowed, type LicenseStore, type RateLimiter } from './licenses.js'
import { originLock, secretsEqual } from './origin.js'
import type { Resizer } from './resize.js'
import type { AvatarResolver, Identity } from './resolver.js'
import type { IndexStore, Visibility } from './store.js'
import type { UsageMeter } from './usage.js'

export interface AppDeps {
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
  /** PLUS_DIDS comma list: the user plan gate (spec section 11.2). Gallery images ship in profile JSON only for these DIDs. */
  plusDids?: string
  /** Clock for the restricted-scope day bucket. Tests override it. */
  now?: () => number
}

type Ok = Extract<EntitlementResult, { ok: true }>

function fail(c: Context, status: number, code: ErrorCode, message: string) {
  return c.json(errorBody(code, message), status as 400)
}

function rateHeaders(c: Context, e: EntitlementResult) {
  const w = e.window
  if (w && w.limit > 0) {
    c.header('x-rate-limit-limit', String(w.limit))
    c.header('x-rate-limit-remaining', String(w.remaining))
    c.header('x-rate-limit-reset', String(w.reset))
  }
  if (e.ok) {
    c.header('x-tier', e.tier)
    if (e.licenseId) c.header('x-usage-cost', '1')
  }
}

function originHost(c: Context): string | null {
  for (const v of [c.req.header('origin'), c.req.header('referer')]) {
    if (!v) continue
    try {
      return new URL(v).hostname
    } catch {
      /* ignore */
    }
  }
  return null
}

/** True when the request carries an Origin header that is neither this service's host nor the profile site's host. */
function isCrossOriginRequest(origin: string | undefined, ownHosts: readonly string[]): boolean {
  if (!origin) return false
  try {
    return !ownHosts.includes(new URL(origin).host)
  } catch {
    return true
  }
}

const QR_DEFAULT_SIZE = 256
const DEFAULT_PROFILE_BASE_URL = 'https://blueyvatar.com'

const PLATFORM_SLUG = /^[a-z0-9-]+$/

const IMG_FILE = /^(\d{1,4})(?:-q(\d{1,3}))?\.(png|jpeg|webp)$/

function isRestricted(v: Visibility): boolean {
  return v.keyedOnly || v.domainAllowlist.length > 0
}

export function createApp(deps: AppDeps) {
  const app = new Hono()

  // Image responses never set cookies, and nothing here does (spec section 14.1).
  app.use('*', async (c, next) => {
    await next()
    c.header('x-content-type-options', 'nosniff')
  })

  if (deps.originSecret) app.use('*', originLock(deps.originSecret))

  const clientIp = (c: Context) =>
    (deps.trustCloudflare ? c.req.header('cf-connecting-ip') : undefined)
    ?? deps.remoteAddress?.(c)
    ?? 'unknown'

  async function entitle(c: Context) {
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
    rateHeaders(c, e)
    if (!e.ok && e.status === 429 && e.window) {
      c.header('retry-after', String(Math.max(1, e.window.reset - Math.floor(Date.now() / 1000))))
    }
    return e
  }

  function isCrossOrigin(c: Context): boolean {
    const own = [new URL(c.req.url).host, new URL(deps.profileBaseUrl ?? DEFAULT_PROFILE_BASE_URL).host]
    return isCrossOriginRequest(c.req.header('origin'), own)
  }

  function respondDefault(c: Context, p: AvatarParams, seed: string, initials: string) {
    c.header('cache-control', `private, max-age=${p.ttlSeconds}`)
    if (p.default.kind === 'style' && p.default.style === '404') {
      return fail(c, 404, 'not_found', 'No avatar for this identity')
    }
    if (p.default.kind === 'url') return c.redirect(p.default.url, 302)
    const style = p.default.kind === 'style' ? p.default.style : 'mp'
    // blank is a transparent image, so it is always PNG (JPEG has no alpha channel).
    const format = style === 'blank' ? 'png' : p.format
    return c.redirect(`/default/${style}/${p.size}.${format}?seed=${encodeURIComponent(seed)}${initials ? `&initials=${initials}` : ''}`, 302)
  }

  function respondJsonMiss(c: Context, p: AvatarParams) {
    c.header('cache-control', `private, max-age=${p.ttlSeconds}`)
    return c.json({ did: null, handle: null, found: false, source: 'default', rating: null, url: null, updatedDate: null })
  }

  /** The visibility rules when this caller may fetch the avatar (spec section 10.2), else null. */
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

  /**
   * `lookup` receives a gate that does the database-only checks (repo active, visibility rules).
   * Hash lookups must call it before any network identity resolution, so that unlinked,
   * opted-out, and restricted hashes all take the same cheap path and return the same default.
   */
  async function serveAvatar(
    c: Context,
    lookup: (gate: (did: string) => Promise<boolean>) => Promise<Identity | null>,
    seed: string,
    initials = '',
  ) {
    const e = await entitle(c)
    if (!e.ok) return fail(c, e.status, e.code, e.message)

    let p: AvatarParams
    try {
      p = parseAvatarParams(new URL(c.req.url).searchParams, { tier: e.tier, defaultUrlAllowlist: deps.defaultUrlAllowlist })
    } catch (err) {
      if (err instanceof ParamError) return fail(c, 400, err.code as ErrorCode, err.message)
      throw err
    }
    if (p.adjusted.length) c.header('x-adjusted-params', p.adjusted.join(','))

    const gate = async (did: string) => (await deps.index.isRepoActive(did)) && (await visibilityAllows(c, did, e)) !== null
    const identity = await lookup(gate)
    if (e.licenseId) {
      const used = await deps.usage.add(e.licenseId, 'origin_resolution')
      await deps.alerts?.check(e.licenseId, e.tier, used)
    }
    // With json=true every miss answers in JSON with found: false, and every miss body is the
    // same, so a hash lookup cannot tell an unlinked hash from a hidden or restricted one.
    const miss = () => (p.json ? respondJsonMiss(c, p) : respondDefault(c, p, seed, initials))
    if (!identity || !(await deps.index.isRepoActive(identity.did))) return miss()
    const vis = await visibilityAllows(c, identity.did, e)
    if (!vis) return miss()

    const picked = pickCandidate(await deps.resolver.candidates(identity), p.rating, p.forceDefault)
    const path = picked.kind === 'image'
      ? signedPath(c, e, vis, identity.did, picked.candidate.blob.cid, p.size, p.format, p.format === 'png' ? undefined : p.quality)
      : null
    if (p.json) {
      c.header('cache-control', `private, max-age=${p.ttlSeconds}`)
      return c.json({
        did: identity.did,
        handle: identity.handle,
        found: picked.kind === 'image',
        source: picked.kind === 'image' ? picked.candidate.source : 'default',
        rating: picked.kind === 'image' ? picked.candidate.rating : null,
        url: path,
        updatedDate: picked.kind === 'image' ? (picked.candidate.updatedAt ?? null) : null,
      })
    }
    if (!path) return respondDefault(c, p, seed, initials)
    c.header('cache-control', `private, max-age=${p.ttlSeconds}`)
    return c.redirect(path, 302)
  }

  app.onError((err, c) => {
    console.error('unhandled error', err)
    return c.json(errorBody('internal', 'Internal server error'), 500)
  })

  app.get('/healthz', (c) => c.text('ok'))

  // Gravatar-compatible route. Hash only (SHA256 or MD5); raw email is never accepted (spec section 6).
  app.get('/avatar/:hash', async (c) => {
    const hash = c.req.param('hash').toLowerCase().replace(/\.(png|jpe?g|webp)$/, '')
    // MD5 is accepted for older Gravatar clients and takes the same path as SHA256.
    if (!isSha256Hex(hash) && !isMd5Hex(hash)) return fail(c, 400, 'invalid_identifier', 'Expected a SHA256 (64 hex) or MD5 (32 hex) hash of the email')
    // Every miss (unlinked, opted out, inactive, restricted for this caller) ends in the same
    // default redirect before any identity resolution, so the response does not reveal a link.
    return serveAvatar(c, async (gate) => {
      const did = await deps.index.didForEmailHash(hash)
      if (!did || !(await gate(did))) return null
      return deps.resolver.resolveIdentity({ kind: 'did', value: did })
    }, hash, initialsFromName(c.req.query('name')))
  })

  app.get('/u/:id', async (c) => {
    const id = parseIdentifier(c.req.param('id'))
    if (!id || id.kind === 'hash') return fail(c, 400, 'invalid_identifier', 'Expected a handle or DID')
    return serveAvatar(c, () => deps.resolver.resolveIdentity(id as { kind: 'did' | 'handle'; value: string }), id.value,
      id.kind === 'handle' ? cleanInitials(id.value) : '')
  })

  // Hovercards on other sites read profile JSON from the browser. No cookies are
  // used, so any origin may read it; publishable keys still enforce their domains.
  app.use('/profile/*', cors({
    origin: '*',
    allowMethods: ['GET'],
    exposeHeaders: ['x-rate-limit-limit', 'x-rate-limit-remaining', 'x-rate-limit-reset', 'x-tier'],
  }))

  app.get('/profile/:id', async (c) => {
    const e = await entitle(c)
    if (!e.ok) return fail(c, e.status, e.code, e.message)
    // Cross-origin browser callers are hovercards embedded on other sites (Business and Enterprise).
    // Same-origin pages and server-to-server calls without an Origin header are not gated.
    if (isCrossOrigin(c) && !ENTITLEMENTS[e.tier].hovercards) {
      return fail(c, 403, 'tier_required', 'Hovercards require a Business or Enterprise key')
    }
    const id = parseIdentifier(c.req.param('id'))
    if (!id) return fail(c, 400, 'invalid_identifier', 'Expected a hash, handle, or DID')
    let identity: Identity | null = null
    if (id.kind === 'hash') {
      const did = await deps.index.didForEmailHash(id.value)
      identity = did ? await deps.resolver.resolveIdentity({ kind: 'did', value: did }) : null
    } else {
      identity = await deps.resolver.resolveIdentity(id)
    }
    if (e.licenseId) await deps.usage.add(e.licenseId, 'profile_json')
    if (!identity || !(await deps.index.isRepoActive(identity.did))) return fail(c, 404, 'not_found', 'No profile')
    const vis = await deps.index.visibility(identity.did)
    if (vis.hiddenProfile) return fail(c, 404, 'not_found', 'No profile')
    if (!(await visibilityAllows(c, identity.did, e))) {
      // A hash lookup must not tell a restricted profile apart from an unlinked hash.
      return id.kind === 'hash' ? fail(c, 404, 'not_found', 'No profile') : fail(c, 403, 'access_denied', 'Profile not available to this caller')
    }

    const [bsky, own] = await Promise.all([
      deps.resolver.getRecord(identity, 'app.bsky.actor.profile', 'self').catch(() => null),
      deps.resolver.getRecord(identity, 'com.blueyvatar.profile', 'self').catch(() => null),
    ])
    const picked = pickCandidate(await deps.resolver.candidates(identity), 'g', false)
    // Attested claims only. The Free tier cap applies to the JSON (spec section 11.1); the
    // oldest verifications are kept. Hidden accounts stay in the list with hidden: true.
    const cap = ENTITLEMENTS[e.tier].maxVerifiedAccountsInJson
    const verified = await deps.index.verifiedAccounts(identity.did)
    // Gallery images are a Plus user feature (spec section 11.2). They follow the avatar rules:
    // the rating filter is the avatar default (g), blocked images never come back, and URLs
    // are signed /img paths. The page shows at most GALLERY_MAX.
    const gallery = isPlusDid(identity.did, deps.plusDids)
      ? (await deps.resolver.galleryItems(identity))
          .filter((g) => ratingAllowed(g.rating, 'g'))
          .slice(0, GALLERY_MAX)
          .map((g) => ({ url: signedPath(c, e, vis, identity.did, g.cid, 512, 'png'), caption: g.caption }))
      : []
    c.header('cache-control', 'private, max-age=300')
    return c.json({
      did: identity.did,
      handle: identity.handle,
      displayName: bsky?.displayName ?? null,
      description: bsky?.description ?? null,
      links: resolveProfileLinks(identity.did, bsky?.links, await deps.index.profileLinks(identity.did)),
      avatar: picked.kind === 'image' ? { url: signedPath(c, e, vis, identity.did, picked.candidate.blob.cid, 256, 'png'), source: picked.candidate.source } : null,
      jobTitle: own?.jobTitle ?? null,
      company: own?.company ?? null,
      location: own?.location ?? null,
      pronouns: own?.pronouns ?? null,
      pronunciation: own?.pronunciation ?? null,
      timezone: own?.timezone ?? null,
      interests: own?.interests ?? [],
      gallery,
      verifiedAccounts: cap === null ? verified : verified.slice(0, cap),
      profileUrl: identity.handle ? `/p/${identity.handle}` : null,
    })
  })

  // QR code for the profile URL. Business and Enterprise only (spec sections 8 and 11.1).
  // The response needs a key check, so it is private to the browser, like the redirects.
  app.get('/qr/:file', async (c) => {
    const e = await entitle(c)
    if (!e.ok) return fail(c, e.status, e.code, e.message)
    if (!ENTITLEMENTS[e.tier].hovercards) {
      return fail(c, 403, 'tier_required', 'QR codes require a Business or Enterprise key')
    }
    const file = c.req.param('file')
    const dot = file.lastIndexOf('.')
    const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : ''
    if (ext !== 'svg' && ext !== 'png') return fail(c, 404, 'not_found', 'Use a .svg or .png path')
    const id = parseIdentifier(file.slice(0, dot))
    if (!id) return fail(c, 400, 'invalid_identifier', 'Expected a hash, handle, or DID')

    let p: AvatarParams
    try {
      const sp = new URL(c.req.url).searchParams
      p = parseAvatarParams(sp, { tier: e.tier, defaultUrlAllowlist: deps.defaultUrlAllowlist })
      if (sp.get('s') === null && sp.get('size') === null) p.size = QR_DEFAULT_SIZE
    } catch (err) {
      if (err instanceof ParamError) return fail(c, 400, err.code as ErrorCode, err.message)
      throw err
    }
    if (p.adjusted.includes('s')) c.header('x-adjusted-params', 's')
    const to = c.req.query('to')
    if (to !== undefined && !PLATFORM_SLUG.test(to)) return fail(c, 400, 'invalid_platform', 'to must be a platform name such as github')

    let identity: Identity | null
    if (id.kind === 'hash') {
      const did = await deps.index.didForEmailHash(id.value)
      identity = did ? await deps.resolver.resolveIdentity({ kind: 'did', value: did }) : null
    } else {
      identity = await deps.resolver.resolveIdentity(id)
    }
    if (e.licenseId) await deps.usage.add(e.licenseId, 'origin_resolution')
    // The profile page lives at /p/{handle}, so an identity without a handle has no QR target.
    if (!identity?.handle || !(await deps.index.isRepoActive(identity.did))) return fail(c, 404, 'not_found', 'No profile')
    if ((await deps.index.visibility(identity.did)).hiddenProfile) return fail(c, 404, 'not_found', 'No profile')
    if (!(await visibilityAllows(c, identity.did, e))) {
      return id.kind === 'hash' ? fail(c, 404, 'not_found', 'No profile') : fail(c, 403, 'access_denied', 'Profile not available to this caller')
    }

    const base = (deps.profileBaseUrl ?? DEFAULT_PROFILE_BASE_URL).replace(/\/+$/, '')
    const target = to ? `${base}/go/${encodeURIComponent(identity.handle)}/${to}` : `${base}/p/${identity.handle}`
    const svg = qrSvg(target, p.size)
    let body: Uint8Array | string = svg
    if (ext === 'png') {
      try {
        body = await deps.resize({ input: new TextEncoder().encode(svg), size: p.size, format: 'png', quality: 85 })
      } catch {
        return fail(c, 502, 'upstream_error', 'Could not render the QR code')
      }
    }
    c.header('cache-control', `private, max-age=${p.ttlSeconds}`)
    c.header('content-type', ext === 'png' ? 'image/png' : 'image/svg+xml')
    return c.body(body as string & Uint8Array<ArrayBuffer>, 200)
  })

  // Public redirect from a QR code to one of the user's verified platforms, or to the profile page
  // when that platform is missing, hidden, or not an https link (spec section 8). Hidden profiles
  // and unknown handles look the same to the caller.
  app.get('/go/:handle/:platform', async (c) => {
    const e = await entitle(c)
    if (!e.ok) return fail(c, e.status, e.code, e.message)
    const id = parseIdentifier(c.req.param('handle'))
    if (!id || id.kind !== 'handle') return fail(c, 404, 'not_found', 'No profile')
    const identity = await deps.resolver.resolveIdentity(id)
    if (e.licenseId) await deps.usage.add(e.licenseId, 'origin_resolution')
    if (!identity?.handle || !(await deps.index.isRepoActive(identity.did))) return fail(c, 404, 'not_found', 'No profile')
    if ((await deps.index.visibility(identity.did)).hiddenProfile) return fail(c, 404, 'not_found', 'No profile')

    const base = (deps.profileBaseUrl ?? DEFAULT_PROFILE_BASE_URL).replace(/\/+$/, '')
    const fallback = `${base}/p/${identity.handle}`
    const platform = c.req.param('platform').toLowerCase()
    let target = fallback
    if (platform === 'bluesky') {
      target = `https://bsky.app/profile/${identity.handle}`
    } else {
      const match = (await deps.index.verifiedAccounts(identity.did)).find((a) => !a.hidden && a.platform.toLowerCase() === platform)
      if (match) {
        try {
          if (new URL(match.uri).protocol === 'https:') target = match.uri
        } catch {
          /* keep the fallback */
        }
      }
    }
    c.header('cache-control', 'private, max-age=60')
    return c.redirect(target, 302)
  })

  // Immutable resized image. Cached by Cloudflare by file extension (spec section 14.1).
  // Only paths signed by the redirect routes are served (issues #68 and #72). Cloudflare's default
  // cache key is the full URL including the query string, so the origin sends every signed but
  // non-canonical request (off-ladder size, other quality, query string, other DID encoding) to
  // the one canonical signed URL for its variant and scope. That keeps one cache entry per
  // variant and lets the indexer purge exactly the URLs that can exist. Redirecting is cheaper
  // than a resize.
  app.get('/img/:did/:cid/:sig/:file', async (c) => {
    const did = decodeURIComponent(c.req.param('did'))
    const cid = c.req.param('cid')
    const file = c.req.param('file')
    const m = IMG_FILE.exec(file)
    if (!m || !/^[a-z0-9]{10,100}$/.test(cid)) return fail(c, 404, 'not_found', 'Unknown image')
    const size = Number(m[1])
    const quality = m[2] ? Number(m[2]) : undefined
    const format = m[3] as ImageFormat
    if (size < 1 || size > ABSOLUTE_MAX_SIZE) return fail(c, 404, 'invalid_size', 'Size must be from 1 to 2048')
    if (quality !== undefined && (quality < 1 || quality > 100)) return fail(c, 404, 'invalid_quality', 'Quality must be from 1 to 100')
    // The signature covers the file name as requested, so an edited size or quality fails here
    // before any redirect; a non-canonical path only reaches the redirect when it was signed.
    const scope = verifyImageSig(deps.imgSigningSecret, did, cid, file, c.req.param('sig'))
    if (scope === null) return fail(c, 403, 'invalid_signature', 'Image path is not signed for this service')
    if (scope && scopeExpired(scope, deps.now?.())) return fail(c, 403, 'signature_expired', 'Image path has expired; fetch the avatar again')
    const canonical = imagePath(deps.imgSigningSecret, did, cid, size, format, quality, scope)
    const url = new URL(c.req.url)
    if (url.search !== '' || url.pathname !== canonical) {
      c.header('cache-control', 'public, max-age=3600')
      return c.redirect(canonical, 302)
    }
    if (!(await deps.index.isRepoActive(did)) || (await deps.index.isBlocked(did, cid))) {
      return fail(c, 404, 'not_found', 'Image unavailable')
    }
    // A public URL issued before the user switched to keyed only or a domain allowlist stays
    // signed forever, so the current rules are checked here as well: once restricted, only
    // scoped (and so expiring) paths are served.
    if (!scope && isRestricted(await deps.index.visibility(did))) {
      return fail(c, 403, 'access_denied', 'Avatar is restricted; fetch it through /avatar or /u')
    }
    const identity = await deps.resolver.resolveIdentity({ kind: 'did', value: did })
    if (!identity) return fail(c, 404, 'not_found', 'Unknown identity')
    let bytes: Uint8Array
    try {
      const original = await deps.resolver.getBlob(identity, cid)
      bytes = await deps.resize({ input: original, size, format, quality: quality ?? CANONICAL_QUALITY })
    } catch {
      return fail(c, 502, 'upstream_error', 'Could not fetch or process the image')
    }
    // /img has no key: a resize on a CDN miss is a service cost against the DID, not a license charge.
    // Cache warming (valid x-warm-auth) is a service cost the indexer chose to incur, so it is not metered.
    const warm = c.req.header(WARM_HEADER)
    const isWarm = !!deps.warmSecret && !!warm && secretsEqual(warm, deps.warmSecret)
    if (!isWarm) {
      await deps.usage.addService(did, 'transform')
      await deps.usage.addService(did, 'bytes_delivered', bytes.byteLength)
    }
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'content-type': `image/${format}`,
      'cache-control': IMMUTABLE_CACHE_CONTROL,
    })
  })

  // Unsigned legacy shape, or a path with the signature stripped.
  app.get('/img/*', (c) => fail(c, 403, 'invalid_signature', 'Image path is not signed for this service'))

  // Defaults stay unsigned: they carry no user content, no visibility rule applies to them, and
  // the output is a pure function of the public style, seed, and initials, so there is nothing
  // for a signature to protect. The 24h public cache bounds the resize cost.
  app.get('/default/:style/:file', async (c) => {
    const style = c.req.param('style')
    const m = IMG_FILE.exec(c.req.param('file'))
    if (!m || !(DEFAULT_STYLES as readonly string[]).includes(style) || style === '404') {
      return fail(c, 404, 'not_found', 'Unknown default')
    }
    const size = Math.min(Number(m[1]), 2048)
    const seed = c.req.query('seed') ?? ''
    const svg = defaultSvg(style as DefaultStyle, seed, cleanInitials(c.req.query('initials')))
    const bytes = await deps.resize({ input: new TextEncoder().encode(svg), size, format: m[3] as 'png', quality: 85 })
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'content-type': `image/${m[3]}`,
      'cache-control': 'public, max-age=86400',
    })
  })

  return app
}
