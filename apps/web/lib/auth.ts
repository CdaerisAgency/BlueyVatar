import { randomBytes } from 'node:crypto'
import { JoseKey } from '@atproto/jwk-jose'
import { NodeOAuthClient, type NodeOAuthClientOptions } from '@atproto/oauth-client-node'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { deviceHint } from './device'
import { NEXT_COOKIE, loginPath, safeNext } from './next-path'
import { PUBLIC_URL, clientMetadata } from './oauth'
import { COOKIE_NAME, SESSION_TTL_MS, parseSession, signSession } from './session-cookie'
import { getStore } from './store'

const g = globalThis as { __bvClient?: Promise<NodeOAuthClient>; __bvDevSecret?: string }

/** The signing key comes from OAUTH_PRIVATE_JWK (JSON JWK, kept in Infisical). */
export function oauthClient(): Promise<NodeOAuthClient> {
  g.__bvClient ??= (async () => {
    const raw = process.env.OAUTH_PRIVATE_JWK
    if (!raw) throw new Error('OAUTH_PRIVATE_JWK is not set. Generate one with `pnpm --filter @blueyvatar/web gen-jwk`.')
    const store = getStore()
    return new NodeOAuthClient({
      // PUBLIC_URL is a runtime string, so the literal URL types need a cast.
      clientMetadata: clientMetadata() as NodeOAuthClientOptions['clientMetadata'],
      keyset: [await JoseKey.fromJWK(raw)],
      stateStore: store.oauthState,
      sessionStore: store.oauthSession,
      allowHttp: PUBLIC_URL.startsWith('http://localhost'),
    })
  })()
  g.__bvClient.catch(() => {
    g.__bvClient = undefined
  })
  return g.__bvClient
}

function sessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET is not set')
  g.__bvDevSecret ??= randomBytes(32).toString('hex')
  return g.__bvDevSecret
}

/** The signed-in DID and the id of this browser's session row (null for a cookie issued before sessions were tracked). */
export async function currentSession(): Promise<{ did: string; sid: string | null } | null> {
  const jar = await cookies()
  const c = parseSession(jar.get(COOKIE_NAME)?.value, sessionSecret(), Date.now())
  if (!c) return null
  return (await getStore().sessions.valid(c.did, c.sid, c.issuedAt)) ? { did: c.did, sid: c.sid } : null
}

export async function currentDid(): Promise<string | null> {
  return (await currentSession())?.did ?? null
}

/** For account pages: the signed-in DID, or a redirect to sign-in that brings the user back to `path` afterward. */
export async function requireDid(path: string): Promise<string> {
  const did = await currentDid()
  if (!did) redirect(loginPath(path))
  return did
}

export async function setSessionCookie(did: string): Promise<void> {
  const jar = await cookies()
  const sid = await getStore().sessions.create(did, deviceHint((await headers()).get('user-agent')))
  jar.set(COOKIE_NAME, signSession(did, sessionSecret(), Date.now(), sid), {
    httpOnly: true,
    secure: PUBLIC_URL.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
}

export async function clearSessionCookie(): Promise<void> {
  ;(await cookies()).delete(COOKIE_NAME)
}

/** Remembers where to send the user after the OAuth round trip. Lax cookie, 15 minutes. */
export async function rememberNext(raw: string | null | undefined): Promise<void> {
  const jar = await cookies()
  const next = safeNext(raw)
  if (next === '/account') jar.delete(NEXT_COOKIE)
  else jar.set(NEXT_COOKIE, next, { httpOnly: true, secure: PUBLIC_URL.startsWith('https://'), sameSite: 'lax', path: '/', maxAge: 15 * 60 })
}

/** Reads and clears the remembered destination. */
export async function takeNext(): Promise<string> {
  const jar = await cookies()
  const next = safeNext(jar.get(NEXT_COOKIE)?.value)
  jar.delete(NEXT_COOKIE)
  return next
}
