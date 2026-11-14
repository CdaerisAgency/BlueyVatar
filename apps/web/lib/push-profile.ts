import type { CropParams } from '@blueyvatar/core'
import { prepareAvatar } from './push-avatar-image'
import { HOME_SERVER_TERM } from './home-server'
import { limitLabel, type PushApp } from './push-apps'
import type { BlobRef } from './repo'

/**
 * Changes only the avatar on the user's own profile record for one app (`app.collection`, record key `self`),
 * for any app in push-apps.ts. Every other field, including fields this code does not know, and the record type
 * are written back exactly as read. The write carries `swapRecord` with the version just read, so a change made in
 * the app in the meantime is reported and never overwritten. A missing record is created only when the caller says
 * the user agreed (`allowCreate`), and then holds only `$type` and `avatar`. Issues #241, #298.
 */

/** What an OAuth session offers here. A test passes a mock home server with the same shape. */
export type HomeServer = { did: string; fetchHandler(pathname: string, init?: RequestInit): Promise<Response> }

export type PushFailure = 'no_permission' | 'no_profile' | 'conflict' | 'too_large' | 'bad_image' | 'blob_gone' | 'home_server'
export type PushResult =
  | { ok: true; avatar: BlobRef | null; previous: BlobRef | null; created: boolean }
  | { ok: false; code: PushFailure; message: string }

const SERVER_SENTENCE = `Y${HOME_SERVER_TERM.slice(1)}` // HOME_SERVER_TERM begins with "your"

/** The message for each way a push can fail, naming the app. These are what the page shows. */
export function pushMessages(app: PushApp): Record<PushFailure, string> {
  return {
    no_permission: `BlueyVatar does not have your permission to change your ${app.name} profile picture. Tick the box for ${app.name} to allow it.`,
    no_profile: `${SERVER_SENTENCE} has no ${app.name} profile record for you yet, so there is no picture to change.`,
    conflict: `Your ${app.name} profile changed while this was saving, so nothing was changed. Check the picture it shows now, then try again.`,
    too_large: `This image is still larger than the ${limitLabel(app.avatar.maxBytes)} limit for ${app.name} after shrinking it. Choose a simpler or smaller image.`,
    bad_image: 'The image could not be prepared as a profile picture. Choose a different PNG or JPEG.',
    blob_gone: `Your previous ${app.name} picture is no longer stored on ${HOME_SERVER_TERM}, so it cannot be restored.`,
    home_server: `${SERVER_SENTENCE} could not be reached or refused the change. Try again in a few minutes.`,
  }
}
export type PushFailed = Extract<PushResult, { ok: false }>
const fail = (app: PushApp, code: PushFailure): PushFailed => ({ ok: false, code, message: pushMessages(app)[code] })

type ProfileValue = { $type?: string; avatar?: BlobRef; [k: string]: unknown }
type Read = { cid: string; value: ProfileValue } | 'none' | 'no_permission' | 'home_server'

async function readProfile(server: HomeServer, app: PushApp): Promise<Read> {
  let res: Response
  try {
    res = await server.fetchHandler(`/xrpc/com.atproto.repo.getRecord?${new URLSearchParams({ repo: server.did, collection: app.collection, rkey: 'self' })}`)
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

const codeFor = (status: number): PushFailure => (status === 401 || status === 403 ? 'no_permission' : 'home_server')

/** Writes `next` as the avatar (or removes it when null) over the version read. Nothing else in the record changes. */
async function writeAvatar(server: HomeServer, app: PushApp, current: { cid: string; value: ProfileValue }, next: BlobRef | null): Promise<PushResult> {
  const { avatar: previous, ...rest } = current.value
  const record: ProfileValue = { ...rest, $type: current.value.$type ?? app.collection, ...(next ? { avatar: next } : {}) }
  let res: Response
  try {
    res = await server.fetchHandler('/xrpc/com.atproto.repo.putRecord', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: server.did, collection: app.collection, rkey: 'self', record, swapRecord: current.cid }),
    })
  } catch {
    return fail(app, 'home_server')
  }
  if (res.ok) return { ok: true, avatar: next, previous: previous ?? null, created: false }
  const err = (await res.json().catch(() => ({}))) as { error?: string }
  if (err.error === 'InvalidSwap') return fail(app, 'conflict')
  if (err.error === 'InvalidBlob' || err.error === 'BlobNotFound') return fail(app, 'blob_gone')
  return fail(app, codeFor(res.status))
}

/**
 * Creates the profile record with only the avatar. `createRecord` with record key `self` fails when a record
 * exists, so a record made elsewhere in the meantime is never replaced (it reports a conflict).
 */
async function createProfile(server: HomeServer, app: PushApp, next: BlobRef): Promise<PushResult> {
  let res: Response
  try {
    res = await server.fetchHandler('/xrpc/com.atproto.repo.createRecord', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: server.did, collection: app.collection, rkey: 'self', record: { $type: app.collection, avatar: next } }),
    })
  } catch {
    return fail(app, 'home_server')
  }
  if (res.ok) return { ok: true, avatar: next, previous: null, created: true }
  const err = (await res.json().catch(() => ({}))) as { error?: string }
  if (err.error === 'InvalidSwap' || err.error === 'RecordAlreadyExists') return fail(app, 'conflict')
  if (err.error === 'InvalidBlob' || err.error === 'BlobNotFound') return fail(app, 'blob_gone')
  return fail(app, codeFor(res.status))
}

async function uploadAvatar(server: HomeServer, bytes: Uint8Array, mime: string): Promise<BlobRef | PushFailure> {
  try {
    const res = await server.fetchHandler('/xrpc/com.atproto.repo.uploadBlob', { method: 'POST', headers: { 'content-type': mime }, body: bytes as BodyInit })
    if (!res.ok) return codeFor(res.status)
    const blob = ((await res.json()) as { blob?: BlobRef }).blob
    return blob ?? 'home_server'
  } catch {
    return 'home_server'
  }
}

/** The avatar blob on the profile right now: null when there is none. `no_profile` when the record does not exist. */
export async function currentAvatar(server: HomeServer, app: PushApp): Promise<{ ok: true; avatar: BlobRef | null } | PushFailed> {
  const r = await readProfile(server, app)
  if (r === 'none') return fail(app, 'no_profile')
  if (typeof r === 'string') return fail(app, r)
  return { ok: true, avatar: r.value.avatar ?? null }
}

/**
 * Shrinks the stored image to a square under the app's limit, uploads it, and sets it as the profile avatar.
 * With no record and `allowCreate` false it stops with `no_profile` before uploading anything.
 */
export async function setProfileAvatar(
  server: HomeServer,
  app: PushApp,
  image: { bytes: Uint8Array; crop?: CropParams | null },
  opts: { allowCreate?: boolean } = {},
): Promise<PushResult> {
  const current = await readProfile(server, app)
  if (current === 'none' && !opts.allowCreate) return fail(app, 'no_profile')
  if (typeof current === 'string' && current !== 'none') return fail(app, current)
  const prepared = await prepareAvatar(image.bytes, image.crop, { maxBytes: app.avatar.maxBytes, label: limitLabel(app.avatar.maxBytes) })
  if (!prepared.ok) return { ok: false, code: prepared.error.includes('still larger') ? 'too_large' : 'bad_image', message: prepared.error }
  const blob = await uploadAvatar(server, prepared.value.bytes, prepared.value.mime)
  if (typeof blob === 'string') return fail(app, blob)
  return current === 'none' ? createProfile(server, app, blob) : writeAvatar(server, app, current, blob)
}

/** Puts a blob the profile held before back as the avatar, or removes the avatar when it had none. */
export async function restoreProfileAvatar(server: HomeServer, app: PushApp, previous: BlobRef | null): Promise<PushResult> {
  const current = await readProfile(server, app)
  if (current === 'none') return fail(app, 'no_profile')
  if (typeof current === 'string') return fail(app, current)
  return writeAvatar(server, app, current, previous)
}
