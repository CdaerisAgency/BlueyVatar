import { randomBytes } from 'node:crypto'
import { JoseKey } from '@atproto/jwk-jose'
import { NodeOAuthClient, type NodeOAuthClientOptions } from '@atproto/oauth-client-node'
import { cookies } from 'next/headers'
import { PUBLIC_URL, clientMetadata } from './oauth'
import { COOKIE_NAME, SESSION_TTL_MS, readSession, signSession } from './session-cookie'
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

export async function currentDid(): Promise<string | null> {
  const jar = await cookies()
  return readSession(jar.get(COOKIE_NAME)?.value, sessionSecret(), Date.now())
}

export async function setSessionCookie(did: string): Promise<void> {
  const jar = await cookies()
  jar.set(COOKIE_NAME, signSession(did, sessionSecret(), Date.now()), {
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
