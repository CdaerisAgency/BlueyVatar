import type { CropParams } from '@blueyvatar/core'
import { BSKY_PROFILE_COLLECTION } from './oauth'
import { prepareBlueskyAvatar } from './bsky-avatar-image'
import { HOME_SERVER_TERM } from './home-server'
import type { BlobRef } from './repo'

/**
 * Changes only the avatar on the user's own Bluesky profile record (app.bsky.actor.profile/self).
 * Every other field, including fields this code does not know, and the record type are written back exactly
 * as read. The write carries `swapRecord` with the version just read, so a change made on Bluesky in the
 * meantime is reported and never overwritten. Issue #241.
 */

/** What an OAuth session offers here. A test passes a mock home server with the same shape. */
export type HomeServer = { did: string; fetchHandler(pathname: string, init?: RequestInit): Promise<Response> }

export type BskyAvatarFailure = 'no_permission' | 'no_profile' | 'conflict' | 'too_large' | 'bad_image' | 'blob_gone' | 'home_server'
export type BskyAvatarResult =
  | { ok: true; avatar: BlobRef | null; previous: BlobRef | null }
  | { ok: false; code: BskyAvatarFailure; message: string }

const SERVER_SENTENCE = `Y${HOME_SERVER_TERM.slice(1)}` // HOME_SERVER_TERM begins with "your"

export const BSKY_MESSAGES: Record<BskyAvatarFailure, string> = {
  no_permission: 'Sign in again to allow this. BlueyVatar needs your permission to change the picture on your profile.',
  no_profile: `${SERVER_SENTENCE} has no app.bsky.actor.profile record for you yet, so there is no profile picture to change. Save your profile once in an app that uses it, then try again.`,
  conflict: 'Your profile changed while this was saving, so nothing was changed. Check the picture your profile shows now, then try again.',
  too_large: 'This image is still larger than the 1 MB limit for profile avatars after shrinking it. Choose a simpler or smaller image.',
  bad_image: 'The image could not be prepared as a profile avatar. Choose a different PNG or JPEG.',
  blob_gone: `Your previous profile picture is no longer stored on ${HOME_SERVER_TERM}, so it cannot be restored.`,
  home_server: `${SERVER_SENTENCE} could not be reached or refused the change. Try again in a few minutes.`,
}
const fail = (code: BskyAvatarFailure): BskyAvatarResult => ({ ok: false, code, message: BSKY_MESSAGES[code] })

type ProfileValue = { $type?: string; avatar?: BlobRef; [k: string]: unknown }
type Read = { cid: string; value: ProfileValue } | 'none' | 'no_permission' | 'home_server'

async function readProfile(server: HomeServer): Promise<Read> {
  let res: Response
  try {
    res = await server.fetchHandler(`/xrpc/com.atproto.repo.getRecord?${new URLSearchParams({ repo: server.did, collection: BSKY_PROFILE_COLLECTION, rkey: 'self' })}`)
  } catch {
    return 'home_server'
  }
  if (res.ok) {
    const body = (await res.json().catch(() => null)) as { cid?: string; value?: ProfileValue } | null
    return body?.cid && body.value && typeof body.value === 'object' ? { cid: body.cid, value: body.value } : 'home_server'
  }
  const err = (await res.json().catch(() => ({}))) as { error?: string }
  if (err.error === 'RecordNotFound') return 'none'
  return res.status === 401 || res.status === 403 ? 'no_permission' : 'home_server'
}

/** Writes `next` as the avatar (or removes it when null) over the version read. Nothing else in the record changes. */
async function writeAvatar(server: HomeServer, current: { cid: string; value: ProfileValue }, next: BlobRef | null): Promise<BskyAvatarResult> {
  const { avatar: previous, ...rest } = current.value
  const record: ProfileValue = { ...rest, $type: current.value.$type ?? BSKY_PROFILE_COLLECTION, ...(next ? { avatar: next } : {}) }
  let res: Response
  try {
    res = await server.fetchHandler('/xrpc/com.atproto.repo.putRecord', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: server.did, collection: BSKY_PROFILE_COLLECTION, rkey: 'self', record, swapRecord: current.cid }),
    })
  } catch {
    return fail('home_server')
  }
  if (res.ok) return { ok: true, avatar: next, previous: previous ?? null }
  const err = (await res.json().catch(() => ({}))) as { error?: string }
  if (err.error === 'InvalidSwap') return fail('conflict')
  if (err.error === 'InvalidBlob' || err.error === 'BlobNotFound') return fail('blob_gone')
  return fail(res.status === 401 || res.status === 403 ? 'no_permission' : 'home_server')
}

async function uploadAvatar(server: HomeServer, bytes: Uint8Array, mime: string): Promise<BlobRef | BskyAvatarFailure> {
  try {
    const res = await server.fetchHandler('/xrpc/com.atproto.repo.uploadBlob', { method: 'POST', headers: { 'content-type': mime }, body: bytes as BodyInit })
    if (!res.ok) return res.status === 401 || res.status === 403 ? 'no_permission' : 'home_server'
    const blob = ((await res.json()) as { blob?: BlobRef }).blob
    return blob ?? 'home_server'
  } catch {
    return 'home_server'
  }
}

/** The avatar blob on the profile right now: null when there is none, or a failure when it cannot be read. */
export async function currentBlueskyAvatar(server: HomeServer): Promise<{ ok: true; avatar: BlobRef | null } | { ok: false; code: BskyAvatarFailure; message: string }> {
  const r = await readProfile(server)
  if (r === 'none') return fail('no_profile')
  if (typeof r === 'string') return fail(r)
  return { ok: true, avatar: r.value.avatar ?? null }
}

/** Shrinks the stored image to a square under 1,000,000 bytes, uploads it, and sets it as the profile avatar. */
export async function setBlueskyAvatar(server: HomeServer, image: { bytes: Uint8Array; crop?: CropParams | null }): Promise<BskyAvatarResult> {
  const current = await readProfile(server)
  if (current === 'none') return fail('no_profile')
  if (typeof current === 'string') return fail(current)
  const prepared = await prepareBlueskyAvatar(image.bytes, image.crop)
  if (!prepared.ok) return { ok: false, code: prepared.error.includes('still larger') ? 'too_large' : 'bad_image', message: prepared.error }
  const blob = await uploadAvatar(server, prepared.value.bytes, prepared.value.mime)
  if (typeof blob === 'string') return fail(blob)
  return writeAvatar(server, current, blob)
}

/** Puts a blob the profile held before back as the avatar, or removes the avatar when it had none. */
export async function restoreBlueskyAvatar(server: HomeServer, previous: BlobRef | null): Promise<BskyAvatarResult> {
  const current = await readProfile(server)
  if (current === 'none') return fail('no_profile')
  if (typeof current === 'string') return fail(current)
  return writeAvatar(server, current, previous)
}
