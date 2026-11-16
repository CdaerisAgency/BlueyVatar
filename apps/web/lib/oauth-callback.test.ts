import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeSavedSession, NodeSavedSessionStore, NodeSavedStateStore } from '@atproto/oauth-client-node'
import { memoryOauthStores } from './oauth-stores'
import { PUBLIC_URL } from './oauth'

const DID = 'did:plc:abcdefghijklmnopqrstuvwx'
const mem = memoryOauthStores()

// A stand-in for NodeOAuthClient that does what the real one does with its stores: callback() reads and deletes the
// saved state, saves the new token set under the account's DID, and signOut() deletes that entry.
vi.mock('@atproto/oauth-client-node', () => ({
  NodeOAuthClient: class {
    constructor(private o: { stateStore: NodeSavedStateStore; sessionStore: NodeSavedSessionStore }) {}
    async callback(params: URLSearchParams) {
      const key = params.get('state')!
      const saved = (await this.o.stateStore.get(key)) as unknown as { appState?: string }
      await this.o.stateStore.del(key)
      await this.o.sessionStore.set(DID, { tokenSet: { sub: DID, scope: params.get('scope') ?? '' } } as unknown as NodeSavedSession)
      const sessionStore = this.o.sessionStore
      return { session: { did: DID, signOut: async () => void (await sessionStore.del(DID)) }, state: saved.appState ?? null }
    }
  },
}))
vi.mock('@atproto/jwk-jose', () => ({ JoseKey: { fromJWK: async () => ({}) } }))
vi.mock('./store', () => ({ getStore: () => mem }))
vi.mock('./auth', async (orig) => ({
  ...(await orig<typeof import('./auth')>()),
  currentDid: async () => DID,
  setSessionCookie: async () => undefined,
  takeNext: async () => '/',
}))
vi.mock('./link', () => ({ linkFromSession: async () => ({ kind: 'linked', masked: 'a***@example.com' }) }))
vi.mock('./rate-guard', () => ({ limitedResult: async () => ({ ok: true }) }))
vi.mock('./tap', () => ({ trackAccountInTap: async () => undefined }))

import { GET } from '../app/oauth/callback/route'

const main = { tokenSet: { sub: DID, scope: 'atproto repo:com.blueyvatar.image' } } as unknown as NodeSavedSession

async function callback(appState: 'login' | 'link', key: string) {
  await mem.oauthState.set(key, { appState } as never)
  return GET(new Request(`http://localhost/oauth/callback?state=${key}&scope=${appState}`))
}

describe('GET /oauth/callback', () => {
  beforeEach(() => {
    process.env.OAUTH_PRIVATE_JWK = '{}'
  })

  it('keeps the main sign-in session when an email link finishes (it used to be replaced, then deleted)', async () => {
    await callback('login', 'k1')
    await mem.oauthSession.set(DID, main)
    const res = await callback('link', 'k2')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(new URL('/account', PUBLIC_URL).toString())
    expect(await mem.oauthSession.get(DID)).toEqual(main)
    expect(await mem.oauthSession.get(`link:${DID}`)).toBeUndefined()
  })

  it('a normal sign-in still stores the main session', async () => {
    await mem.oauthSession.del(DID)
    await callback('login', 'k3')
    expect(await mem.oauthSession.get(DID)).toBeDefined()
  })
})
