import { currentDid } from './auth'
import { repoHandle } from './claims-repo'
import { getPool } from './pool'
import { repoSession } from './repo'
import { makeTtlCache } from './viewer-core'

export type Viewer = { did: string; handle: string | null }

const HANDLE_TTL_MS = 5 * 60_000
const FAIL_TTL_MS = 30_000
const cache = makeTtlCache<string | null>(HANDLE_TTL_MS)
const failed = makeTtlCache<true>(FAIL_TTL_MS)

/** The handle the indexer stored for a DID, or null when there is none, it is `handle.invalid`, or there is no database. */
export async function indexedHandle(did: string): Promise<string | null> {
  const pool = getPool()
  if (!pool) return null
  const { rows } = await pool.query<{ handle: string | null }>('SELECT handle FROM repos WHERE did = $1', [did])
  const h = rows[0]?.handle
  return h && h !== 'handle.invalid' ? h : null
}

/** The handle for a DID, read from the account's own repo. Falls back to the indexed handle in `repos`. Null when neither can be resolved right now. */
export async function resolveHandle(did: string): Promise<string | null> {
  const hit = cache.get(did)
  if (hit !== undefined) return hit
  if (failed.get(did)) return null
  let handle: string | null = null
  try {
    handle = await repoHandle(await repoSession(did))
  } catch {
    // No usable OAuth session (expired, revoked, or never stored): the indexed handle below still answers.
  }
  if (!handle) {
    try {
      handle = await indexedHandle(did)
    } catch {
      handle = null
    }
  }
  if (handle) cache.set(did, handle)
  else failed.set(did, true)
  return handle
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
