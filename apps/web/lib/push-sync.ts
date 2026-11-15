import { ratingFromLabels } from '@blueyvatar/core'
import { currentAvatar, pushMessages, restoreProfileAvatar, setProfileAvatar, type HomeServer, type PushFailed, type PushResult } from './push-profile'
import { PUSH_APPS, type PushApp } from './push-apps'
import type { PushStore } from './push-store'
import { HOME_SERVER_TERM } from './home-server'
import { readCapped } from './import'
import { grantsProfileWrite } from './oauth'
import { imageLabels, type StoredImage } from './repo'
import { MAX_BLOB_BYTES } from './records'

/**
 * Pushes the default image to the apps the user turned on (issues #241 and #298). Entry points: the per-image
 * "Push to <app>" button, the automatic push after the default image changes, the first push when an app is
 * turned on, and the undo. None of them throws. A failed push is reported as a message and never blocks anything else.
 */

/** An OAuth session as this module uses it. The scope comes from the granted token, so a session without the app's permission reports it missing. */
export type SyncSession = HomeServer & { getTokenInfo(refresh?: boolean): Promise<{ scope?: string }> }
export type SyncDeps = {
  store: PushStore
  /** Rate limit for one account. Returns a message to show, or null to go ahead. */
  limit: () => Promise<string | null>
}
export type SyncOutcome = { ok: boolean; changed: boolean; message: string }

export const RATING_BLOCKED_MESSAGE = 'Images rated R or X cannot be sent to your profile. Choose a G or PG image.'
export const ALREADY_MATCHES_MESSAGE = 'Your profile picture already shows this image.'
export const firstAutoNotice = (app: PushApp): string => `We changed your ${app.name} profile picture to match your default image. You can undo it below, or turn this off on the Integrations page.`

/** Null when the image may be pushed, else the reason it may not. Only G and PG images may. */
export function pushBlockReason(image: StoredImage): string | null {
  const r = ratingFromLabels(imageLabels(image))
  return r === 'r' || r === 'x' ? RATING_BLOCKED_MESSAGE : null
}

/** An import that became the default is pushed, except an import of the Bluesky avatar itself, which Bluesky already shows. */
export const syncsAfterImport = (source: string, becameDefault: boolean): boolean => becameDefault && source !== 'bluesky'

/** True when the session's granted scope lets blueyvatar create and update this app's profile record. */
export async function hasPushPermission(session: SyncSession, app: PushApp): Promise<boolean> {
  try {
    return grantsProfileWrite(app.collection, (await session.getTokenInfo(false)).scope)
  } catch {
    return false
  }
}

async function loadSource(session: HomeServer, image: StoredImage): Promise<Uint8Array | null> {
  try {
    const res = await session.fetchHandler(`/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did: session.did, cid: image.value.image.ref.$link })}`, { signal: AbortSignal.timeout(8000) })
    return res.ok ? await readCapped(res, MAX_BLOB_BYTES) : null
  } catch {
    return null
  }
}

const failure = (message: string): SyncOutcome => ({ ok: false, changed: false, message })
const fromResult = (r: PushFailed): SyncOutcome => failure(r.message)

/**
 * Sends one stored image to one app. `auto` marks a change made by the switch rather than the button.
 * `allowCreate` is true only when the user agreed to create a profile record they never had. Left out, it follows what they agreed when they turned the app on.
 */
export async function pushToApp(session: SyncSession, app: PushApp, image: StoredImage, deps: SyncDeps, opts: { auto?: boolean; allowCreate?: boolean } = {}): Promise<SyncOutcome> {
  const messages = pushMessages(app)
  try {
    if (!(await hasPushPermission(session, app))) return failure(messages.no_permission)
    const blocked = pushBlockReason(image)
    if (blocked) return failure(blocked)
    const did = session.did
    const sourceCid = image.value.image.ref.$link
    const [state, current] = await Promise.all([deps.store.get(did, app.id), currentAvatar(session, app)])
    // A record is created only when the user agreed to it: just now (`allowCreate`), or earlier when they turned the app on (`mayCreate`).
    const allowCreate = opts.allowCreate ?? state.mayCreate
    if (!current.ok && !(current.code === 'no_profile' && allowCreate)) return fromResult(current)
    const shown = current.ok ? (current.avatar?.ref.$link ?? null) : null
    // Same picture: the app already shows this blob, or the last write from this image is still what it shows.
    if (shown && (shown === sourceCid || (state.lastSourceCid === sourceCid && state.lastSentCid === shown))) return { ok: true, changed: false, message: ALREADY_MATCHES_MESSAGE }
    const wait = await deps.limit()
    if (wait) return failure(wait)
    const bytes = await loadSource(session, image)
    if (!bytes) return failure(`The image could not be read from ${HOME_SERVER_TERM}. Try again in a few minutes.`)
    const r: PushResult = await setProfileAvatar(session, app, { bytes, crop: image.value.crop }, { allowCreate })
    if (!r.ok) return fromResult(r)
    await deps.store.recordChange(did, app.id, { action: opts.auto ? 'auto_set' : 'set', previous: r.previous, sentCid: r.avatar?.ref.$link ?? null, sourceCid })
    const first = opts.auto && (await deps.store.get(did, app.id)).autoNoticePending
    return { ok: true, changed: true, message: first ? firstAutoNotice(app) : `Your ${app.name} profile picture was updated.` }
  } catch {
    return failure(messages.home_server)
  }
}

/**
 * Called after the default image changed in blueyvatar. Pushes to every app the user turned on and returns a short
 * note for the page, or null when there is nothing to say (no app on, no default, or every app already shows it).
 * Never throws and never blocks the change.
 */
export async function syncAfterDefaultChange(session: SyncSession, defaultImage: StoredImage | undefined, deps: SyncDeps, apps: readonly PushApp[] = PUSH_APPS): Promise<string | null> {
  try {
    if (!defaultImage) return null
    const on = new Set(await deps.store.enabledApps(session.did))
    const notes: string[] = []
    for (const app of apps.filter((a) => on.has(a.id))) {
      const out = await pushToApp(session, app, defaultImage, deps, { auto: true })
      if (out.changed) notes.push(out.message)
      else if (!out.ok) notes.push(`Your default image changed, but your ${app.name} picture did not. ${out.message}`)
    }
    return notes.length ? notes.join(' ') : null
  } catch {
    return null
  }
}

/** Puts the picture an app's profile held before the last push back. */
export async function restorePrevious(session: SyncSession, app: PushApp, deps: SyncDeps): Promise<SyncOutcome> {
  const messages = pushMessages(app)
  try {
    if (!(await hasPushPermission(session, app))) return failure(messages.no_permission)
    const state = await deps.store.get(session.did, app.id)
    if (state.previous === undefined) return failure(`There is no earlier ${app.name} picture to restore.`)
    const wait = await deps.limit()
    if (wait) return failure(wait)
    const r = await restoreProfileAvatar(session, app, state.previous)
    if (!r.ok) return fromResult(r)
    await deps.store.recordChange(session.did, app.id, { action: 'restore', previous: r.previous, sentCid: r.avatar?.ref.$link ?? null, sourceCid: null })
    return { ok: true, changed: true, message: `Your previous ${app.name} picture is back.` }
  } catch {
    return failure(messages.home_server)
  }
}

export type EnableOutcome = { kind: 'enabled'; message: string } | { kind: 'ask_create'; message: string } | { kind: 'error'; message: string }

/**
 * Finishes turning an app on, after its permission was granted. When the account has no profile record for the app
 * it stops and asks (`ask_create`) until the user agrees (`create`). Then it remembers the choice and, when there is a
 * default image, pushes it now. Never throws.
 */
export async function enableApp(session: SyncSession, app: PushApp, defaultImage: StoredImage | undefined, deps: SyncDeps, opts: { create?: boolean } = {}): Promise<EnableOutcome> {
  const messages = pushMessages(app)
  try {
    if (!(await hasPushPermission(session, app))) return { kind: 'error', message: messages.no_permission }
    const current = await currentAvatar(session, app)
    let mayCreate = false
    if (!current.ok) {
      if (current.code !== 'no_profile') return { kind: 'error', message: current.message }
      if (!opts.create) {
        return { kind: 'ask_create', message: `${current.message} BlueyVatar can create one that holds only your picture.` }
      }
      mayCreate = true
    }
    await deps.store.setEnabled(session.did, app.id, true, mayCreate)
    if (!defaultImage) return { kind: 'enabled', message: `Pushing to ${app.name} is on. Your picture goes there when you choose a default image.` }
    const out = await pushToApp(session, app, defaultImage, deps)
    if (out.ok) return { kind: 'enabled', message: `Pushing to ${app.name} is on. ${out.message}` }
    return { kind: 'enabled', message: `Pushing to ${app.name} is on, but your picture was not sent yet. ${out.message}` }
  } catch {
    return { kind: 'error', message: messages.home_server }
  }
}

/** Turns an app off. Later default-image changes are not pushed to it. The profile keeps the picture it has. */
export async function disableApp(deps: Pick<SyncDeps, 'store'>, did: string, app: PushApp): Promise<string> {
  await deps.store.setEnabled(did, app.id, false)
  await deps.store.clearConsent(did, app.id)
  return `Pushing to ${app.name} is off. Your ${app.name} profile keeps the picture it has now. BlueyVatar stops using the permission you gave for it.`
}
