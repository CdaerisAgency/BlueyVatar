import type { OAuthSession } from '@atproto/oauth-client-node'
import { oauthClient } from './auth'
import { IMAGE_COLLECTION, PROFILE_COLLECTION, labelValues, type ImageMime } from './records'

/** Shapes of the XRPC responses used here (com.atproto.repo.*). */
export type StrongRef = { uri: string; cid: string }
export type BlobRef = { $type: 'blob'; ref: { $link: string }; mimeType: string; size: number }
export type ImageRecord = {
  image: BlobRef
  alt?: string
  labels?: unknown
  license?: string
  isDefault?: boolean
  createdAt: string
}
export type ProfileRecord = {
  defaultImage?: StrongRef
  jobTitle?: string
  company?: string
  location?: string
  pronouns?: string
  pronunciation?: string
  timezone?: string
  interests?: string[]
  createdAt: string
  [k: string]: unknown
}
export type StoredImage = { uri: string; cid: string; rkey: string; value: ImageRecord }

export class RepoError extends Error {}

/** Restores the stored OAuth session for the signed-in DID. Throws RepoError if it is gone. */
export async function repoSession(did: string): Promise<OAuthSession> {
  try {
    return await (await oauthClient()).restore(did)
  } catch {
    throw new RepoError('Your session with your PDS expired. Sign in again.')
  }
}

async function xrpc<T>(session: OAuthSession, method: 'GET' | 'POST', nsid: string, opts: { params?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const qs = opts.params ? `?${new URLSearchParams(opts.params)}` : ''
  const res = await session.fetchHandler(`/xrpc/${nsid}${qs}`, {
    method,
    ...(opts.body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body) } : {}),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    throw new RepoError(err.error ?? `PDS request failed (${res.status})`)
  }
  return (await res.json()) as T
}

export const rkeyOf = (uri: string): string => uri.slice(uri.lastIndexOf('/') + 1)

export async function listImages(session: OAuthSession): Promise<StoredImage[]> {
  const out: StoredImage[] = []
  let cursor: string | undefined
  for (let page = 0; page < 5; page++) {
    const r = await xrpc<{ cursor?: string; records: { uri: string; cid: string; value: ImageRecord }[] }>(session, 'GET', 'com.atproto.repo.listRecords', {
      params: { repo: session.did, collection: IMAGE_COLLECTION, limit: '100', ...(cursor ? { cursor } : {}) },
    })
    for (const x of r.records) out.push({ uri: x.uri, cid: x.cid, rkey: rkeyOf(x.uri), value: x.value })
    cursor = r.cursor
    if (!cursor) break
  }
  return out
}

export async function getProfile(session: OAuthSession): Promise<{ cid: string; value: ProfileRecord } | null> {
  const res = await session.fetchHandler(
    `/xrpc/com.atproto.repo.getRecord?${new URLSearchParams({ repo: session.did, collection: PROFILE_COLLECTION, rkey: 'self' })}`,
  )
  if (res.ok) return (await res.json()) as { cid: string; value: ProfileRecord }
  const err = (await res.json().catch(() => ({}))) as { error?: string }
  if (err.error === 'RecordNotFound') return null
  throw new RepoError(err.error ?? `PDS request failed (${res.status})`)
}

export async function uploadBlob(session: OAuthSession, bytes: Uint8Array, mime: ImageMime): Promise<BlobRef> {
  const res = await session.fetchHandler('/xrpc/com.atproto.repo.uploadBlob', {
    method: 'POST',
    headers: { 'content-type': mime },
    body: bytes as BodyInit,
  })
  if (!res.ok) throw new RepoError('Your PDS rejected the upload.')
  return ((await res.json()) as { blob: BlobRef }).blob
}

export function createImage(session: OAuthSession, record: ImageRecord): Promise<StrongRef> {
  return xrpc<StrongRef>(session, 'POST', 'com.atproto.repo.createRecord', { body: { repo: session.did, collection: IMAGE_COLLECTION, record: { $type: IMAGE_COLLECTION, ...record } } })
}

export async function putProfile(session: OAuthSession, record: ProfileRecord, swapRecord?: string): Promise<void> {
  await xrpc(session, 'POST', 'com.atproto.repo.putRecord', {
    body: { repo: session.did, collection: PROFILE_COLLECTION, rkey: 'self', record: { $type: PROFILE_COLLECTION, ...record }, ...(swapRecord ? { swapRecord } : {}) },
  })
}

type Write = Record<string, unknown>

/**
 * Make one image the default: every image record gets isDefault set to match and the profile's
 * defaultImage strongRef points at it. One applyWrites call keeps them consistent.
 */
export async function setDefaultImage(session: OAuthSession, target: StoredImage): Promise<void> {
  const images = await listImages(session)
  const writes: Write[] = []
  for (const img of images) {
    const want = img.rkey === target.rkey
    if ((img.value.isDefault === true) === want) continue
    writes.push({ $type: 'com.atproto.repo.applyWrites#update', collection: IMAGE_COLLECTION, rkey: img.rkey, value: { $type: IMAGE_COLLECTION, ...img.value, isDefault: want } })
  }
  const profile = await getProfile(session)
  // Updating an image changes its CID, so fetch the new CID after the writes for the strongRef.
  const apply = (w: Write[]) => xrpc(session, 'POST', 'com.atproto.repo.applyWrites', { body: { repo: session.did, writes: w } })
  if (writes.length) await apply(writes)
  const fresh = (await listImages(session)).find((i) => i.rkey === target.rkey)
  if (!fresh) throw new RepoError('That image no longer exists.')
  const value: ProfileRecord = { ...(profile?.value ?? { createdAt: new Date().toISOString() }), defaultImage: { uri: fresh.uri, cid: fresh.cid } }
  await putProfile(session, value, profile?.cid)
}

export async function deleteImage(session: OAuthSession, rkey: string): Promise<void> {
  const profile = await getProfile(session)
  await xrpc(session, 'POST', 'com.atproto.repo.deleteRecord', { body: { repo: session.did, collection: IMAGE_COLLECTION, rkey } })
  if (profile?.value.defaultImage && rkeyOf(profile.value.defaultImage.uri) === rkey) {
    const { defaultImage: _gone, ...rest } = profile.value
    await putProfile(session, rest as ProfileRecord, profile.cid)
  }
}

export async function pdsUrl(session: OAuthSession): Promise<string> {
  return (await session.getTokenInfo(false)).aud as string
}

export const blobUrl = (pds: string, did: string, cid: string): string =>
  `${pds.replace(/\/$/, '')}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did, cid })}`

export const imageLabels = (img: StoredImage): string[] => labelValues(img.value.labels)
