/**
 * OAuth sign-in used only to read which account the user controls (docs/research/verified-accounts-v1.md).
 * One definition per platform. Each is off until its flag is `true` and its app credentials are set, so a
 * platform that still needs app review stays hidden until the review is done. Tokens are not kept.
 */
export const OAUTH_PROVIDERS = ['instagram', 'threads', 'tiktok', 'youtube', 'twitch'] as const
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number]
export const isOAuthProvider = (v: unknown): v is OAuthProvider => typeof v === 'string' && (OAUTH_PROVIDERS as readonly string[]).includes(v)

export type ProviderConfig = { clientId: string; clientSecret: string }

/** Env names per provider: the on switch, the app id, the app secret. */
export const PROVIDER_ENV: Record<OAuthProvider, { flag: string; id: string; secret: string }> = {
  instagram: { flag: 'VERIFY_INSTAGRAM_ENABLED', id: 'INSTAGRAM_APP_ID', secret: 'INSTAGRAM_APP_SECRET' },
  threads: { flag: 'VERIFY_THREADS_ENABLED', id: 'THREADS_APP_ID', secret: 'THREADS_APP_SECRET' },
  tiktok: { flag: 'VERIFY_TIKTOK_ENABLED', id: 'TIKTOK_CLIENT_KEY', secret: 'TIKTOK_CLIENT_SECRET' },
  youtube: { flag: 'VERIFY_YOUTUBE_ENABLED', id: 'GOOGLE_CLIENT_ID', secret: 'GOOGLE_CLIENT_SECRET' },
  twitch: { flag: 'VERIFY_TWITCH_ENABLED', id: 'TWITCH_CLIENT_ID', secret: 'TWITCH_CLIENT_SECRET' },
}

type Env = Record<string, string | undefined>

/** Null (disabled) unless the flag is exactly "true" and both credentials are set. */
export function providerConfig(p: OAuthProvider, env: Env = process.env): ProviderConfig | null {
  const e = PROVIDER_ENV[p]
  return env[e.flag] === 'true' && env[e.id] && env[e.secret] ? { clientId: env[e.id]!, clientSecret: env[e.secret]! } : null
}

const q = (o: Record<string, string>): string => new URLSearchParams(o).toString()
const FORM = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

export function providerAuthorizeUrl(p: OAuthProvider, c: ProviderConfig, redirectUri: string, state: string): string {
  switch (p) {
    case 'instagram':
      return `https://www.instagram.com/oauth/authorize?${q({ client_id: c.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'instagram_business_basic', state })}`
    case 'threads':
      return `https://threads.com/oauth/authorize?${q({ client_id: c.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'threads_basic', state })}`
    case 'tiktok':
      return `https://www.tiktok.com/v2/auth/authorize/?${q({ client_key: c.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'user.info.profile', state })}`
    case 'youtube':
      return `https://accounts.google.com/o/oauth2/v2/auth?${q({ client_id: c.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.readonly', state })}`
    case 'twitch':
      return `https://id.twitch.tv/oauth2/authorize?${q({ client_id: c.clientId, redirect_uri: redirectUri, response_type: 'code', scope: '', state })}`
  }
}

async function json(r: Response): Promise<Record<string, unknown>> {
  return obj(await r.json().catch(() => ({})))
}

/**
 * Exchanges the code and reads the account identity: a username (Instagram, Threads, TikTok, Twitch) or the
 * channel ids the user owns (YouTube). Empty on any failure.
 */
export async function providerIdentities(p: OAuthProvider, c: ProviderConfig, code: string, redirectUri: string, f: typeof fetch = fetch): Promise<string[]> {
  const sig = () => AbortSignal.timeout(8000)
  const post = (url: string, body: Record<string, string>) => f(url, { method: 'POST', headers: FORM, body: q(body), signal: sig() })
  const bearer = (url: string, token: string, extra: Record<string, string> = {}) =>
    f(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...extra }, signal: sig() })
  const std = { client_id: c.clientId, client_secret: c.clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }
  try {
    switch (p) {
      case 'instagram': {
        const t = await post('https://api.instagram.com/oauth/access_token', std)
        const tj = await json(t)
        // The exchange answers with the fields at the top level or wrapped in a data array.
        const tok = obj(Array.isArray(tj.data) ? tj.data[0] : tj).access_token
        if (!t.ok || typeof tok !== 'string') return []
        const me = await f(`https://graph.instagram.com/v27.0/me?${q({ fields: 'user_id,username', access_token: tok })}`, { signal: sig() })
        const mj = await json(me)
        const name = obj(Array.isArray(mj.data) ? mj.data[0] : mj).username
        return me.ok && typeof name === 'string' ? [name] : []
      }
      case 'threads': {
        const t = await post('https://graph.threads.com/oauth/access_token', std)
        const tok = (await json(t)).access_token
        if (!t.ok || typeof tok !== 'string') return []
        const me = await f(`https://graph.threads.com/v1.0/me?${q({ fields: 'id,username', access_token: tok })}`, { signal: sig() })
        const name = (await json(me)).username
        return me.ok && typeof name === 'string' ? [name] : []
      }
      case 'tiktok': {
        const t = await post('https://open.tiktokapis.com/v2/oauth/token/', { client_key: c.clientId, client_secret: c.clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri })
        const tok = (await json(t)).access_token
        if (!t.ok || typeof tok !== 'string') return []
        const me = await bearer('https://open.tiktokapis.com/v2/user/info/?fields=open_id,username', tok)
        const name = obj(obj(obj(await json(me)).data).user).username
        return me.ok && typeof name === 'string' ? [name] : []
      }
      case 'youtube': {
        const t = await post('https://oauth2.googleapis.com/token', std)
        const tok = (await json(t)).access_token
        if (!t.ok || typeof tok !== 'string') return []
        const ch = await bearer('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true', tok)
        const items = (await json(ch)).items
        return ch.ok && Array.isArray(items) ? items.map((i) => obj(i).id).filter((x): x is string => typeof x === 'string') : []
      }
      case 'twitch': {
        const t = await post('https://id.twitch.tv/oauth2/token', std)
        const tok = (await json(t)).access_token
        if (!t.ok || typeof tok !== 'string') return []
        const me = await bearer('https://api.twitch.tv/helix/users', tok, { 'client-id': c.clientId })
        const data = (await json(me)).data
        const login = Array.isArray(data) ? obj(data[0]).login : undefined
        return me.ok && typeof login === 'string' ? [login] : []
      }
    }
  } catch {
    return []
  }
}

/** The identity the provider reported must be the claimed account. Names compare case-insensitively. */
export function providerClaimMatches(p: OAuthProvider, identities: string[], claimUri: string): boolean {
  let last = ''
  try {
    last = decodeURIComponent(new URL(claimUri).pathname.split('/').filter(Boolean).pop() ?? '').replace(/^@/, '')
  } catch {
    return false
  }
  if (!last) return false
  return identities.some((i) => (p === 'youtube' ? i === last : i.toLowerCase() === last.toLowerCase()))
}
