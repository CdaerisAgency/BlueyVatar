import type { Hono, Context } from 'hono'
import { ParamError, isMd5Hex, isSha256Hex, parseAvatarParams, parseIdentifier, pickCandidate, type AvatarParams } from '@blueyvatar/core'
import type { Ctx } from '../context.js'
import type { ErrorCode } from '../errors.js'
import { fail } from '../http.js'
import { cleanInitials, initialsFromName } from '../defaults.js'
import type { Identity } from '../resolver.js'

export function mountAvatar(app: Hono, ctx: Ctx): void {
  const { deps, metrics, entitle, visibilityAllows, signedPath } = ctx

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
    metrics.inc('delivery_resolutions_total', { route: 'avatar', result: identity ? 'found' : 'miss' })
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
}
