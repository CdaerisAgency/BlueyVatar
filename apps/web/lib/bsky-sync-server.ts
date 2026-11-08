import { limited } from './rate-guard'
import { getSyncStore } from './bsky-sync-store'
import { syncAfterDefaultChange, type SyncDeps } from './bsky-sync'
import { listImages, repoSession } from './repo'
import { reportError } from './obs'

/** The deps the pages and actions use: the shared store and the per-account limit of 10 Bluesky avatar changes an hour. */
export const syncDeps = (did: string): SyncDeps => ({ store: getSyncStore(), limit: () => limited(['bskyAvatar.did'], did) })

/**
 * Runs after a default image change that did not come from importing the Bluesky avatar. Returns a note to append
 * to the page message, or null. Never throws: a failed sync must not block changing the default image.
 */
export async function syncBlueskyAfterDefaultChange(did: string): Promise<string | null> {
  try {
    const session = await repoSession(did)
    const target = (await listImages(session)).find((i) => i.value.isDefault === true)
    return await syncAfterDefaultChange(session, target, syncDeps(did))
  } catch (err) {
    reportError('bluesky avatar sync failed', err)
    return null
  }
}
