/**
 * atproto apps that blueyvatar can recognize without a sign-in (issue #155).
 *
 * The signed-in DID is already proven, so an account on another atproto app is the same identity.
 * An app counts as linked when the user's repo holds records in one of that app's collections,
 * which `com.atproto.repo.describeRepo` lists. Names, URLs, and NSIDs are recorded with their
 * sources in docs/research/atproto-apps-v1.md.
 */

export interface AtprotoApp {
  id: string
  name: string
  url: string
  description: string
  /** A collection matches when it equals an entry that has no trailing dot, or starts with an entry that ends in a dot. */
  collections: readonly string[]
}

export const ATPROTO_APPS: readonly AtprotoApp[] = [
  { id: 'bluesky', name: 'Bluesky', url: 'https://bsky.app', description: 'Social network.', collections: ['app.bsky.feed.post'] },
  { id: 'tangled', name: 'Tangled', url: 'https://tangled.org', description: 'Federated code forge.', collections: ['sh.tangled.', 'org.tangled.'] },
  { id: 'whitewind', name: 'WhiteWind', url: 'https://whtwnd.com', description: 'Markdown blogging.', collections: ['com.whtwnd.'] },
  { id: 'leaflet', name: 'Leaflet', url: 'https://leaflet.pub', description: 'Social publishing for blogs and newsletters.', collections: ['pub.leaflet.'] },
  { id: 'pckt', name: 'pckt', url: 'https://pckt.blog', description: 'Distraction-free blogging.', collections: ['blog.pckt.'] },
  { id: 'frontpage', name: 'Frontpage', url: 'https://frontpage.fyi', description: 'Federated link aggregator.', collections: ['fyi.unravel.frontpage.'] },
  { id: 'smokesignal', name: 'Smoke Signal', url: 'https://smokesignal.events', description: 'Event discovery and RSVPs.', collections: ['events.smokesignal.'] },
  { id: 'linkat', name: 'Linkat', url: 'https://linkat.blue', description: 'Link in bio, stored in your PDS.', collections: ['blue.linkat.'] },
  { id: 'grain', name: 'Grain', url: 'https://grain.social', description: 'Photo galleries.', collections: ['social.grain.'] },
  { id: 'bookhive', name: 'BookHive', url: 'https://bookhive.buzz', description: 'Book tracking.', collections: ['buzz.bookhive.'] },
  { id: 'teal', name: 'teal.fm', url: 'https://teal.fm', description: 'Music listening history.', collections: ['fm.teal.'] },
  { id: 'semble', name: 'Semble', url: 'https://semble.so', description: 'Collecting and connecting web pages.', collections: ['network.cosmik.'] },
]

const matches = (app: AtprotoApp, collection: string): boolean =>
  app.collections.some((c) => (c.endsWith('.') ? collection.startsWith(c) : collection === c))

/** Apps with at least one matching collection, in catalog order. Anything that is not a string is ignored. */
export function detectAtprotoApps(collections: readonly unknown[]): AtprotoApp[] {
  const list = collections.filter((c): c is string => typeof c === 'string')
  return ATPROTO_APPS.filter((app) => list.some((c) => matches(app, c)))
}

export interface RepoCollectionsOptions {
  pds: string
  did: string
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

/**
 * The collections in a repo, from the PDS's public `com.atproto.repo.describeRepo`.
 * Throws on a network error or a non-OK status, so callers decide how to fall back.
 */
export async function fetchRepoCollections(o: RepoCollectionsOptions): Promise<string[]> {
  const url = new URL('/xrpc/com.atproto.repo.describeRepo', o.pds)
  url.searchParams.set('repo', o.did)
  const res = await (o.fetch ?? globalThis.fetch)(url, { signal: AbortSignal.timeout(o.timeoutMs ?? 5000) })
  if (!res.ok) throw new Error(`describeRepo returned ${res.status}`)
  const body = (await res.json()) as { collections?: unknown }
  return Array.isArray(body.collections) ? body.collections.filter((c): c is string => typeof c === 'string') : []
}

/** Detected apps for a repo. Returns an empty list when the PDS cannot be read. */
export async function detectAtprotoAppsForRepo(o: RepoCollectionsOptions): Promise<AtprotoApp[]> {
  try {
    return detectAtprotoApps(await fetchRepoCollections(o))
  } catch {
    return []
  }
}
