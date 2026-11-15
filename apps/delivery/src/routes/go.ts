import type { Hono } from 'hono'
import { parseIdentifier } from '@blueyvatar/core'
import { gateProfile, type Ctx } from '../context.js'
import { fail } from '../http.js'

export function mountGo(app: Hono, ctx: Ctx): void {
  const { deps, profileBase, entitle } = ctx

  // Public redirect from a QR code to one of the user's verified platforms, or to the profile page
  // when that platform is missing, hidden, or not an https link (spec section 8). Hidden profiles
  // and unknown handles look the same to the caller.
  app.get('/go/:handle/:platform', async (c) => {
    const e = await entitle(c)
    if (!e.ok) return fail(c, e.status, e.code, e.message)
    const id = parseIdentifier(c.req.param('handle'))
    if (!id || id.kind !== 'handle') return fail(c, 404, 'not_found', 'No profile')
    const identity0 = await deps.resolver.resolveIdentity(id)
    if (e.licenseId) await deps.usage.add(e.licenseId, 'origin_resolution')
    const gate = await gateProfile(c, ctx, id, e, identity0, { requireHandle: true, visibility: false })
    if (!gate.ok) return gate.res
    const identity = gate.identity

    const base = profileBase
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
}
