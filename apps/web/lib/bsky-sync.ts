import { ratingFromLabels } from '@blueyvatar/core'
import { BSKY_MESSAGES, currentBlueskyAvatar, restoreBlueskyAvatar, setBlueskyAvatar, type BskyAvatarResult, type HomeServer } from './bsky-profile'
import type { SyncStore } from './bsky-sync-store'
import { HOME_SERVER_TERM } from './home-server'
import { readCapped } from './import'
import { grantsBskyProfileUpdate } from './oauth'
import { imageLabels, type StoredImage } from './repo'
import { MAX_BLOB_BYTES } from './records'

/**
 * Keeps the Bluesky profile avatar in step with the default image (issue #241). Three entry points: the
 * "Use as my Bluesky avatar" button, the automatic sync after the default image changes, and the undo.
 * None of them throws. A failed sync is reported as a message and never blocks anything else.
 */

/** An OAuth session as this module uses it. The scope comes from the granted token, so a session from before the feature reports it missing. */
export type SyncSession = HomeServer & { getTokenInfo(refresh?: boolean): Promise<{ scope?: string }> }
export type SyncDeps = {
  store: SyncStore
  /** Rate limit for one account. Returns a message to show, or null to go ahead. */
  limit: () => Promise<string | null>
}
export type SyncOutcome = { ok: boolean; changed: boolean; message: string }

export const RATING_BLOCKED_MESSAGE = 'Images rated R or X cannot be sent to your profile. Choose a G or PG image.'
export const ALREADY_MATCHES_MESSAGE = 'Your profile avatar already shows this image.'
export const FIRST_AUTO_NOTICE = 'We changed your profile avatar to match your default image. You can undo it below, or turn this off.'

/** Null when the image may go to Bluesky, else the reason it may not. Only G and PG images may. */
export function bskyBlockReason(image: StoredImage): string | null {
  const r = ratingFromLabels(imageLabels(image))
  return r === 'r' || r === 'x' ? RATING_BLOCKED_MESSAGE : null
}

/** An import that became the default is sent to Bluesky, except the Bluesky avatar itself, which Bluesky already shows. */
export const syncsAfterImport = (source: string, becameDefault: boolean): boolean => becameDefault && source !== 'bluesky'

export async function hasBskyPermission(session: SyncSession): Promise<boolean> {
  try {
    return grantsBskyProfileUpdate((await session.getTokenInfo(false)).scope)
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
const fromResult = (r: Extract<BskyAvatarResult, { ok: false }>): SyncOutcome => failure(r.message)

/** Sends one stored image to Bluesky. `auto` marks a change made by the switch rather than the button. */
export async function useAsBlueskyAvatar(session: SyncSession, image: StoredImage, deps: SyncDeps, auto = false): Promise<SyncOutcome> {
  try {
    if (!(await hasBskyPermission(session))) return failure(BSKY_MESSAGES.no_permission)
    const blocked = bskyBlockReason(image)
    if (blocked) return failure(blocked)
    const did = session.did
    const sourceCid = image.value.image.ref.$link
    const [state, current] = await Promise.all([deps.store.get(did), currentBlueskyAvatar(session)])
    if (!current.ok) return fromResult(current)
    const shown = current.avatar?.ref.$link ?? null
    // Same picture: Bluesky already shows this blob, or the last write from this image is still what Bluesky shows.
    if (shown && (shown === sourceCid || (state.lastSourceCid === sourceCid && state.lastSentCid === shown))) return { ok: true, changed: false, message: ALREADY_MATCHES_MESSAGE }
    const wait = await deps.limit()
    if (wait) return failure(wait)
    const bytes = await loadSource(session, image)
    if (!bytes) return failure(`The image could not be read from ${HOME_SERVER_TERM}. Try again in a few minutes.`)
    const r = await setBlueskyAvatar(session, { bytes, crop: image.value.crop })
    if (!r.ok) return fromResult(r)
    await deps.store.recordChange(did, { action: auto ? 'auto_set' : 'set', previous: r.previous, sentCid: r.avatar?.ref.$link ?? null, sourceCid })
    const first = auto && (await deps.store.get(did)).autoNoticePending
    return { ok: true, changed: true, message: first ? FIRST_AUTO_NOTICE : 'Your profile avatar was updated.' }
  } catch {
    return failure(BSKY_MESSAGES.home_server)
  }
}

/**
 * Called after the default image changed in blueyvatar. Returns a short note for the page, or null when there is
 * nothing to say (switch off, permission not granted yet, no default). Never throws and never blocks the change.
 */
export async function syncAfterDefaultChange(session: SyncSession, defaultImage: StoredImage | undefined, deps: SyncDeps): Promise<string | null> {
  try {
    if (!defaultImage) return null
    const state = await deps.store.get(session.did)
    if (!state.autoSync || !(await hasBskyPermission(session))) return null
    const out = await useAsBlueskyAvatar(session, defaultImage, deps, true)
    if (out.changed) return out.message
    if (out.ok) return null // Bluesky already shows this picture
    return `Your default image changed, but your profile avatar did not. ${out.message}`
  } catch {
    return null
  }
}

/** Puts the avatar the profile held before the last change back. */
export async function restorePreviousBlueskyAvatar(session: SyncSession, deps: SyncDeps): Promise<SyncOutcome> {
  try {
    if (!(await hasBskyPermission(session))) return failure(BSKY_MESSAGES.no_permission)
    const state = await deps.store.get(session.did)
    if (state.previous === undefined) return failure('There is no earlier profile avatar to restore.')
    const wait = await deps.limit()
    if (wait) return failure(wait)
    const r = await restoreBlueskyAvatar(session, state.previous)
    if (!r.ok) return fromResult(r)
    await deps.store.recordChange(session.did, { action: 'restore', previous: r.previous, sentCid: r.avatar?.ref.$link ?? null, sourceCid: null })
    return { ok: true, changed: true, message: 'Your previous profile avatar is back.' }
  } catch {
    return failure(BSKY_MESSAGES.home_server)
  }
}
