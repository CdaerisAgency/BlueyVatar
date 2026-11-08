/**
 * Mastodon OAuth per instance (Decision 1; https://docs.joinmastodon.org/methods/apps/ and /methods/oauth/).
 * The app is registered once per instance with POST /api/v1/apps. Every request goes through the
 * guarded fetcher because the instance host comes from the user.
 */
import type { Fetcher } from './safe-fetch.js'
import { parseMastodonUri } from './claims.js'
import { sameUrl } from './relme.js'

export const MASTODON_SCOPE = 'read:accounts'

export type MastodonApp = { instance: string; clientId: string; clientSecret: string; redirectUri: string }

const form = (o: Record<string, string>) => new URLSearchParams(o).toString()
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }

export async function registerApp(instance: string, redirectUri: string, website: string, f: Fetcher): Promise<MastodonApp | null> {
  const r = await f(`https://${instance}/api/v1/apps`, {
    method: 'POST', headers: FORM, maxBytes: 100_000,
    body: form({ client_name: 'BlueyVatar', redirect_uris: redirectUri, scopes: MASTODON_SCOPE, website }),
  })
  const j = safeJson(r.text) as { client_id?: unknown; client_secret?: unknown }
  if (r.status !== 200 || typeof j.client_id !== 'string' || typeof j.client_secret !== 'string') return null
  return { instance, clientId: j.client_id, clientSecret: j.client_secret, redirectUri }
}

export function authorizeUrl(app: MastodonApp, state: string): string {
  return `https://${app.instance}/oauth/authorize?${new URLSearchParams({
    response_type: 'code', client_id: app.clientId, redirect_uri: app.redirectUri, scope: MASTODON_SCOPE, state,
  })}`
}

/** Exchanges the code, reads verify_credentials, and returns the account's profile URL (or null). */
export async function accountUrl(app: MastodonApp, code: string, f: Fetcher): Promise<string | null> {
  const t = await f(`https://${app.instance}/oauth/token`, {
    method: 'POST', headers: FORM, maxBytes: 100_000,
    body: form({
      grant_type: 'authorization_code', code, client_id: app.clientId, client_secret: app.clientSecret,
      redirect_uri: app.redirectUri, scope: MASTODON_SCOPE,
    }),
  })
  const token = (safeJson(t.text) as { access_token?: unknown }).access_token
  if (t.status !== 200 || typeof token !== 'string') return null
  const me = await f(`https://${app.instance}/api/v1/accounts/verify_credentials`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, maxBytes: 500_000 })
  const url = (safeJson(me.text) as { url?: unknown }).url
  return me.status === 200 && typeof url === 'string' ? url : null
}

/** The account URL the instance reported must be the claimed profile URL, on the claimed instance. */
export function mastodonClaimMatches(reportedUrl: string, claimUri: string): boolean {
  const claim = parseMastodonUri(claimUri)
  if (!claim) return false
  try {
    const u = new URL(reportedUrl)
    // Some instances report /users/name. Both forms identify the same local account.
    const m = /^\/(?:@|users\/)([^/]+)\/?$/.exec(u.pathname)
    return u.protocol === 'https:' && u.hostname.toLowerCase() === claim.instance && !!m && (m[1] ?? '').toLowerCase() === claim.user
  } catch {
    return sameUrl(reportedUrl, claimUri)
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
