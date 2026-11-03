/** GitHub OAuth (read:user) used only to read the signed-in login (Decision 1). */
const AUTHORIZE = 'https://github.com/login/oauth/authorize'
const TOKEN = 'https://github.com/login/oauth/access_token'
const USER = 'https://api.github.com/user'

export type GithubConfig = { clientId: string; clientSecret: string }

export function githubConfig(env: Record<string, string | undefined> = process.env): GithubConfig | null {
  return env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } : null
}

export function githubAuthorizeUrl(c: GithubConfig, redirectUri: string, state: string): string {
  return `${AUTHORIZE}?${new URLSearchParams({ client_id: c.clientId, redirect_uri: redirectUri, scope: 'read:user', state, allow_signup: 'false' })}`
}

/** Exchanges the code and returns the account login, or null on any failure. The token is not kept. */
export async function githubLogin(c: GithubConfig, code: string, redirectUri: string, f: typeof fetch = fetch): Promise<string | null> {
  const t = await f(TOKEN, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: c.clientId, client_secret: c.clientSecret, code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(8000),
  })
  const token = ((await t.json().catch(() => ({}))) as { access_token?: string }).access_token
  if (!t.ok || !token) return null
  const u = await f(USER, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'blueyvatar' },
    signal: AbortSignal.timeout(8000),
  })
  const login = ((await u.json().catch(() => ({}))) as { login?: unknown }).login
  return u.ok && typeof login === 'string' ? login : null
}

/** GitHub logins are case-insensitive. */
export const githubClaimMatches = (login: string, claimUri: string): boolean => claimUri.toLowerCase() === `https://github.com/${login.toLowerCase()}`
