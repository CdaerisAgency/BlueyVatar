import { Hono, type Context } from 'hono'
import {
  DEFAULT_STYLES, ENTITLEMENTS, IMMUTABLE_CACHE_CONTROL, ParamError, imagePath, isSha256Hex, parseAvatarParams,
  parseIdentifier, pickCandidate, type AvatarParams, type DefaultStyle,
} from '@blueyvatar/core'
import { checkEntitlement, type EntitlementResult } from './entitlement.js'
import { errorBody, type ErrorCode } from './errors.js'
import type { UsageAlerts } from './alerts.js'
import { cleanInitials, defaultSvg } from './defaults.js'
import { hostAllowed, type LicenseStore, type RateLimiter } from './licenses.js'
import { qrSvg } from './qr.js'
import type { Resizer } from './resize.js'
import type { AvatarResolver, Identity } from './resolver.js'
import type { IndexStore } from './store.js'
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

const QR_DEFAULT_SIZE = 256
const DEFAULT_PROFILE_BASE_URL = 'https://blueyvatar.com'

const IMG_FILE = /^(\d{1,4})(?:-q(\d{1,3}))?\.(png|jpeg|webp)$/

export function createApp(deps: AppDeps) {
  const app = new Hono()

  // Image responses never set cookies, and nothing here does (spec section 14.1).
  app.use('*', async (c, next) => {
    await next()
    c.header('x-content-type-options', 'nosniff')
  })

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
    return e
  }

  function respondDefault(c: Context, p: AvatarParams, seed: string, initials: string) {
    c.header('cache-control', `private, max-age=${p.ttlSeconds}`)
    if (p.default.kind === 'style' && p.default.style === '404') {
      return fail(c, 404, 'not_found', 'No avatar for this identity')
    }
    if (p.default.kind === 'url') return c.redirect(p.default.url, 302)
    const style = p.default.kind === 'style' ? p.default.style : 'mp'
    return c.redirect(`/default/${style}/${p.size}.${p.format}?seed=${encodeURIComponent(seed)}${initials ? `&initials=${initials}` : ''}`, 302)
  }

  async function visibilityAllows(c: Context, did: string, e: Ok) {
    const v = await deps.index.visibility(did)
    if (v.keyedOnly && !e.licenseId) return false
    if (v.domainAllowlist.length > 0) {
      const host = originHost(c)
      if (!host || !hostAllowed(host, v.domainAllowlist)) return false
    }
    return true
  }

  async function serveAvatar(c: Context, lookup: () => Promise<Identity | null>, seed: string, initials = '') {
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

    const identity = await lookup()
    if (e.licenseId) {
      const used = await deps.usage.add(e.licenseId, 'origin_resolution')
      await deps.alerts?.check(e.licenseId, e.tier, used)
    }
    if (!identity || !(await deps.index.isRepoActive(identity.did))) return respondDefault(c, p, seed, initials)
    if (!(await visibilityAllows(c, identity.did, e))) return respondDefault(c, p, seed, initials)

    const picked = pickCandidate(await deps.resolver.candidates(identity), p.rating, p.forceDefault)
    if (p.json) {
      c.header('cache-control', `private, max-age=${p.ttlSeconds}`)
      return c.json({
        did: identity.did,
        handle: identity.handle,
        found: picked.kind === 'image',
        source: picked.kind === 'image' ? picked.candidate.source : 'default',
        rating: picked.kind === 'image' ? picked.candidate.rating : null,
        url: picked.kind === 'image'
          ? imagePath(identity.did, picked.candidate.blob.cid, p.size, p.format, p.format === 'png' ? undefined : p.quality)
          : null,
      })
    }
    if (picked.kind === 'default') return respondDefault(c, p, seed, initials)
    c.header('cache-control', `private, max-age=${p.ttlSeconds}`)
    return c.redirect(
      imagePath(identity.did, picked.candidate.blob.cid, p.size, p.format, p.format === 'png' ? undefined : p.quality),
      302,
    )
  }

  app.get('/healthz', (c) => c.text('ok'))

  // Gravatar-compatible route. Hash only; raw email is never accepted (spec section 6).
  app.get('/avatar/:hash', async (c) => {
    const hash = c.req.param('hash').toLowerCase().replace(/\.(png|jpe?g|webp)$/, '')
    if (!isSha256Hex(hash)) return fail(c, 400, 'invalid_identifier', 'Expected a SHA256 hex hash of the email')
    return serveAvatar(c, async () => {
      const did = await deps.index.didForEmailHash(hash)
      return did ? deps.resolver.resolveIdentity({ kind: 'did', value: did }) : null
    }, hash)
  })

  app.get('/u/:id', async (c) => {
    const id = parseIdentifier(c.req.param('id'))
    if (!id || id.kind === 'hash') return fail(c, 400, 'invalid_identifier', 'Expected a handle or DID')
    return serveAvatar(c, () => deps.resolver.resolveIdentity(id as { kind: 'did' | 'handle'; value: string }), id.value,
      id.kind === 'handle' ? cleanInitials(id.value) : '')
  })

  app.get('/profile/:id', async (c) => {
    const e = await entitle(c)
    if (!e.ok) return fail(c, e.status, e.code, e.message)
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
    if (!(await visibilityAllows(c, identity.did, e))) return fail(c, 403, 'access_denied', 'Profile not available to this caller')

    const [bsky, own] = await Promise.all([
      deps.resolver.getRecord(identity, 'app.bsky.actor.profile', 'self').catch(() => null),
      deps.resolver.getRecord(identity, 'com.blueyvatar.profile', 'self').catch(() => null),
    ])
    const picked = pickCandidate(await deps.resolver.candidates(identity), 'g', false)
    c.header('cache-control', 'private, max-age=300')
    return c.json({
      did: identity.did,
      handle: identity.handle,
      displayName: bsky?.displayName ?? null,
      description: bsky?.description ?? null,
      avatar: picked.kind === 'image' ? { url: imagePath(identity.did, picked.candidate.blob.cid, 256, 'png'), source: picked.candidate.source } : null,
      jobTitle: own?.jobTitle ?? null,
      company: own?.company ?? null,
      location: own?.location ?? null,
      pronouns: own?.pronouns ?? null,
      pronunciation: own?.pronunciation ?? null,
      timezone: own?.timezone ?? null,
      interests: own?.interests ?? [],
      verifiedAccounts: [], // phase v2 (spec section 8)
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
    if (!(await visibilityAllows(c, identity.did, e))) return fail(c, 403, 'access_denied', 'Profile not available to this caller')

    const base = (deps.profileBaseUrl ?? DEFAULT_PROFILE_BASE_URL).replace(/\/+$/, '')
    const svg = qrSvg(`${base}/p/${identity.handle}`, p.size)
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

  // Immutable resized image. Cached by Cloudflare by file extension (spec section 14.1).
  app.get('/img/:did/:cid/:file', async (c) => {
    const did = decodeURIComponent(c.req.param('did'))
    const cid = c.req.param('cid')
    const m = IMG_FILE.exec(c.req.param('file'))
    if (!m || !/^[a-z0-9]{10,100}$/.test(cid)) return fail(c, 404, 'not_found', 'Unknown image')
    const size = Number(m[1])
    const quality = m[2] ? Number(m[2]) : 85
    const format = m[3] as 'png' | 'jpeg' | 'webp'
    if (size < 1 || size > 2048 || quality < 1 || quality > 100) return fail(c, 404, 'not_found', 'Unknown image')
    if (!(await deps.index.isRepoActive(did)) || (await deps.index.isBlocked(did, cid))) {
      return fail(c, 404, 'not_found', 'Image unavailable')
    }
    const identity = await deps.resolver.resolveIdentity({ kind: 'did', value: did })
    if (!identity) return fail(c, 404, 'not_found', 'Unknown identity')
    let bytes: Uint8Array
    try {
      const original = await deps.resolver.getBlob(identity, cid)
      bytes = await deps.resize({ input: original, size, format, quality })
    } catch {
      return fail(c, 502, 'upstream_error', 'Could not fetch or process the image')
    }
    // /img has no key: a resize on a CDN miss is a service cost against the DID, not a license charge.
    await deps.usage.addService(did, 'transform')
    await deps.usage.addService(did, 'bytes_delivered', bytes.byteLength)
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'content-type': `image/${format}`,
      'cache-control': IMMUTABLE_CACHE_CONTROL,
      'x-cache-status': 'MISS',
    })
  })

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
