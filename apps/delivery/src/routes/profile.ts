import {
  normalizeBackgroundColor, EXPORT_CONTENT_TYPES, EXPORT_FORMATS, buildExport, exportFileName, toExportProfile, type ExportFormat, GALLERY_MAX, isPlusDid, ratingAllowed, entitlementsFor, profileExtras, resolveProfileLinks, parseIdentifier, pickCandidate,
} from '@blueyvatar/core'
import type { Hono } from 'hono'
import { cors } from 'hono/cors'
import { gateProfile, type Ctx } from '../context.js'
import { fail } from '../http.js'
import type { Identity } from '../resolver.js'

/** Export suffixes on /profile/:id. */
const EXPORT_SUFFIX = new RegExp(`\\.(${EXPORT_FORMATS.join('|')})$`, 'i')
const isExportFormat = (v: string): v is ExportFormat => (EXPORT_FORMATS as readonly string[]).includes(v)

export function mountProfile(app: Hono, ctx: Ctx): void {
  const { deps, metrics, profileBase, entitle, isCrossOrigin, signedPath, findIdentity } = ctx

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
    // Cross-origin browser callers are hovercards embedded on other sites (Plus, Business, and Enterprise).
    // Same-origin pages and server-to-server calls without an Origin header are not gated.
    if (isCrossOrigin(c) && !entitlementsFor(e.tier).hovercards) {
      return fail(c, 403, 'tier_required', 'Hovercards require a Plus, Business, or Enterprise key')
    }
    // Exports use a suffix (/profile/alice.test.vcf) or ?format=vcf. A suffix is only an export when
    // the rest parses as an identifier. ".md" is also a real top-level domain, so a handle that ends
    // in .md keeps working: it is tried as a whole handle first, and only a miss becomes an export.
    const raw = c.req.param('id')
    const queryFormat = c.req.query('format')?.toLowerCase()
    // An unknown ?format= value is ignored, as it was before exports existed.
    let format: ExportFormat | null = queryFormat !== undefined && isExportFormat(queryFormat) ? queryFormat : null
    let id = parseIdentifier(raw)
    let identity: Identity | null | undefined
    const suffix = format === null ? EXPORT_SUFFIX.exec(raw) : null
    if (suffix) {
      const bare = parseIdentifier(raw.slice(0, -suffix[0].length))
      if (bare) {
        const whole = suffix[1]!.toLowerCase() === 'md' && id ? await findIdentity(id) : null
        if (whole) identity = whole
        else {
          id = bare
          format = suffix[1]!.toLowerCase() as ExportFormat
        }
      }
    }
    if (!id) return fail(c, 400, 'invalid_identifier', 'Expected a hash, handle, or DID')
    if (identity === undefined) identity = await findIdentity(id)
    metrics.inc('delivery_resolutions_total', { route: 'profile', result: identity ? 'found' : 'miss' })
    if (e.licenseId) await deps.usage.add(e.licenseId, 'profile_json')
    const gate = await gateProfile(c, ctx, id, e, identity)
    if (!gate.ok) return gate.res
    identity = gate.identity
    const vis = gate.vis
    // Same condition as the profile_json meter, so the keyed-call count has one source of truth. Never blocks the response.
    if (e.licenseId) await deps.usage.addProfileCall(identity.did).catch(() => undefined)

    const [bsky, own] = await Promise.all([
      deps.resolver.getRecord(identity, 'app.bsky.actor.profile', 'self').catch(() => null),
      deps.resolver.getRecord(identity, 'com.blueyvatar.profile', 'self').catch(() => null),
    ])
    const picked = pickCandidate(await deps.resolver.candidates(identity), 'g', false)
    // Attested claims only. The Free tier cap applies to the JSON (spec section 11.1); the
    // oldest verifications are kept. Hidden accounts stay in the list with hidden: true.
    const cap = entitlementsFor(e.tier).maxVerifiedAccountsInJson
    const verified = await deps.index.verifiedAccounts(identity.did)
    const atprotoApps = (await deps.resolver.repoApps?.(identity).catch(() => [])) ?? []
    // Gallery images are a Plus user feature (spec section 11.2). They follow the avatar rules:
    // the rating filter is the avatar default (g), blocked images never come back, and URLs
    // are signed /img paths. The page shows at most GALLERY_MAX.
    const gallery = isPlusDid(identity.did, deps.plusDids) || (await deps.index.hasPlusSubscription(identity.did, new Date(deps.now?.() ?? Date.now())))
      ? (await deps.resolver.galleryItems(identity))
          .filter((g) => ratingAllowed(g.rating, 'g'))
          .slice(0, GALLERY_MAX)
          .map((g) => ({ url: signedPath(c, e, vis, identity.did, g.cid, 512, 'png'), caption: g.caption }))
      : []
    c.header('cache-control', 'private, max-age=300')
    const body = {
      did: identity.did,
      handle: identity.handle,
      displayName: bsky?.displayName ?? null,
      description: bsky?.description ?? null,
      links: resolveProfileLinks(identity.did, bsky?.links, await deps.index.profileLinks(identity.did)),
      // `url` stays the 256 pixel PNG. `variants` is additive: signed paths for responsive pages (webp 256 and 512, png 512).
      avatar: picked.kind === 'image'
        ? {
            url: signedPath(c, e, vis, identity.did, picked.candidate.blob.cid, 256, 'png'),
            source: picked.candidate.source,
            variants: ([[256, 'webp', 85], [512, 'webp', 85], [512, 'png']] as const).map(([size, format, quality]) => ({
              size, format, url: signedPath(c, e, vis, identity.did, picked.candidate.blob.cid, size, format, quality),
            })),
          }
        : null,
      jobTitle: own?.jobTitle ?? null,
      company: own?.company ?? null,
      location: own?.location ?? null,
      pronouns: own?.pronouns ?? null,
      pronunciation: own?.pronunciation ?? null,
      timezone: own?.timezone ?? null,
      interests: own?.interests ?? [],
      // languages, socialLinks, and wallets. Wallets the owner did not opt in to show are never sent.
      ...profileExtras(own),
      // #rrggbb or null. A stored value that is not exactly that shape is treated as unset.
      backgroundColor: normalizeBackgroundColor(own?.backgroundColor),
      gallery,
      verifiedAccounts: cap === null ? verified : verified.slice(0, cap),
      atprotoApps,
      profileUrl: identity.handle ? `/p/${identity.handle}` : null,
    }
    if (!format) return c.json(body)
    // Exports carry the public fields of that same object: no DID, plan, email data, or hidden wallets.
    const file = toExportProfile({
      profile: body,
      deliveryOrigin: (deps.publicUrl ?? new URL(c.req.url).origin).replace(/\/+$/, ''),
      profileBaseUrl: profileBase,
    })
    c.header('content-type', EXPORT_CONTENT_TYPES[format])
    c.header('content-disposition', `attachment; filename="${exportFileName(identity.handle, format)}"`)
    return c.body(buildExport(format, file))
  })
}
