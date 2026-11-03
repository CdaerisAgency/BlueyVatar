import type { OAuthSession } from '@atproto/oauth-client-node'
import { CLAIM_COLLECTION, type ClaimRecord } from './claims'
import { rkeyOf, xrpc, type StrongRef } from './repo'

export type StoredClaim = { uri: string; cid: string; rkey: string; value: ClaimRecord }

export async function listClaims(session: OAuthSession): Promise<StoredClaim[]> {
  const r = await xrpc<{ records: { uri: string; cid: string; value: ClaimRecord }[] }>(session, 'GET', 'com.atproto.repo.listRecords', {
    params: { repo: session.did, collection: CLAIM_COLLECTION, limit: '100' },
  })
  return r.records.map((x) => ({ uri: x.uri, cid: x.cid, rkey: rkeyOf(x.uri), value: x.value }))
}

export async function getClaim(session: OAuthSession, rkey: string): Promise<StoredClaim | null> {
  try {
    const r = await xrpc<{ uri: string; cid: string; value: ClaimRecord }>(session, 'GET', 'com.atproto.repo.getRecord', {
      params: { repo: session.did, collection: CLAIM_COLLECTION, rkey },
    })
    return { uri: r.uri, cid: r.cid, rkey, value: r.value }
  } catch {
    return null
  }
}

export function createClaim(session: OAuthSession, record: ClaimRecord): Promise<StrongRef> {
  return xrpc<StrongRef>(session, 'POST', 'com.atproto.repo.createRecord', {
    body: { repo: session.did, collection: CLAIM_COLLECTION, record: { $type: CLAIM_COLLECTION, ...record } },
  })
}

export async function putClaim(session: OAuthSession, rkey: string, record: ClaimRecord, swapRecord?: string): Promise<void> {
  await xrpc(session, 'POST', 'com.atproto.repo.putRecord', {
    body: { repo: session.did, collection: CLAIM_COLLECTION, rkey, record: { $type: CLAIM_COLLECTION, ...record }, ...(swapRecord ? { swapRecord } : {}) },
  })
}

export async function deleteClaim(session: OAuthSession, rkey: string): Promise<void> {
  await xrpc(session, 'POST', 'com.atproto.repo.deleteRecord', { body: { repo: session.did, collection: CLAIM_COLLECTION, rkey } })
}

/** The account's current handle, from its own PDS. */
export async function repoHandle(session: OAuthSession): Promise<string | null> {
  const r = await xrpc<{ handle?: string }>(session, 'GET', 'com.atproto.repo.describeRepo', { params: { repo: session.did } })
  return r.handle && r.handle !== 'handle.invalid' ? r.handle : null
}
