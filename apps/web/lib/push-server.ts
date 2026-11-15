import { limited } from './rate-guard'
import { getPushStore } from './push-store'
import { syncAfterDefaultChange, type SyncDeps } from './push-sync'
import { listImages, repoSession } from './repo'
import { reportError } from './obs'

/** The deps the pages and actions use: the shared store and the per-account limit of 10 profile picture changes an hour (one per app). */
export const syncDeps = (did: string): SyncDeps => ({ store: getPushStore(), limit: () => limited(['bskyAvatar.did'], did) })

/**
 * Runs after a default image change that did not come from importing the Bluesky avatar. Returns a note to append
 * to the page message, or null. Never throws: a failed push must not block changing the default image.
 */
export async function pushAfterDefaultChange(did: string): Promise<string | null> {
  try {
    const store = getPushStore()
    if ((await store.enabledApps(did)).length === 0) return null
    const session = await repoSession(did)
    const target = (await listImages(session)).find((i) => i.value.isDefault === true)
    return await syncAfterDefaultChange(session, target, syncDeps(did))
  } catch (err) {
    reportError('avatar push failed', err)
    return null
  }
}
