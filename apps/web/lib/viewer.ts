import { currentDid } from './auth'
import { repoHandle } from './claims-repo'
import { repoSession } from './repo'
import { makeTtlCache } from './viewer-core'

export type Viewer = { did: string; handle: string | null }

const HANDLE_TTL_MS = 5 * 60_000
const FAIL_TTL_MS = 30_000
const cache = makeTtlCache<string | null>(HANDLE_TTL_MS)
const failed = makeTtlCache<true>(FAIL_TTL_MS)

/** The handle for a DID, read from the account's own repo. Null when it cannot be resolved right now. */
export async function resolveHandle(did: string): Promise<string | null> {
  const hit = cache.get(did)
  if (hit !== undefined) return hit
  if (failed.get(did)) return null
  try {
    const handle = await repoHandle(await repoSession(did))
    cache.set(did, handle)
    return handle
  } catch {
    failed.set(did, true)
    return null
  }
}

/** The signed-in person, or null. The handle is null when it could not be resolved, so callers fall back to the DID with displayName(). */
export async function currentViewer(): Promise<Viewer | null> {
  const did = await currentDid()
  return did ? { did, handle: await resolveHandle(did) } : null
}

/** Same as currentViewer for pages that already ran requireDid. */
export async function viewerFor(did: string): Promise<Viewer> {
  return { did, handle: await resolveHandle(did) }
}
