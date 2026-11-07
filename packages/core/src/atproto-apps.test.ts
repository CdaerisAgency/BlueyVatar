import { describe, expect, it } from 'vitest'
import { ATPROTO_APPS, detectAtprotoApps, detectAtprotoAppsForRepo, fetchRepoCollections } from './atproto-apps.js'

const DID = 'did:plc:abcdefghijklmnopqrstuvwx'
const pds = (collections: unknown, status = 200): typeof fetch =>
  (async (input: URL | RequestInfo) => {
    const u = new URL(String(input))
    expect(u.pathname).toBe('/xrpc/com.atproto.repo.describeRepo')
    expect(u.searchParams.get('repo')).toBe(DID)
    return new Response(JSON.stringify({ did: DID, collections }), { status })
  }) as typeof fetch

describe('atproto app detection', () => {
  it('has unique ids and https URLs', () => {
    expect(new Set(ATPROTO_APPS.map((a) => a.id)).size).toBe(ATPROTO_APPS.length)
    for (const a of ATPROTO_APPS) expect(a.url).toMatch(/^https:\/\//)
  })
  it('matches exact collections and prefixes, in catalog order', () => {
    const apps = detectAtprotoApps(['pub.leaflet.document', 'app.bsky.feed.post', 'sh.tangled.repo', 'com.example.other'])
    expect(apps.map((a) => a.id)).toEqual(['bluesky', 'tangled', 'leaflet'])
  })
  it('matches both Tangled namespaces', () => {
    expect(detectAtprotoApps(['org.tangled.actor.profile']).map((a) => a.id)).toEqual(['tangled'])
  })
  it('does not match a Bluesky profile alone or a look-alike prefix', () => {
    expect(detectAtprotoApps(['app.bsky.actor.profile', 'app.bsky.feed.like', 'pub.leafletx.doc', 'com.whtwnd'])).toEqual([])
  })
  it('ignores junk entries', () => {
    expect(detectAtprotoApps([1, null, {}, 'app.bsky.feed.post']).map((a) => a.id)).toEqual(['bluesky'])
  })
})

describe('describeRepo against a mocked PDS', () => {
  it('reads the collections list', async () => {
    expect(await fetchRepoCollections({ pds: 'https://pds.test', did: DID, fetch: pds(['a.b.c', 5]) })).toEqual(['a.b.c'])
  })
  it('detects apps from the PDS response', async () => {
    const apps = await detectAtprotoAppsForRepo({ pds: 'https://pds.test', did: DID, fetch: pds(['com.whtwnd.blog.entry', 'social.grain.gallery']) })
    expect(apps.map((a) => a.name)).toEqual(['WhiteWind', 'Grain'])
  })
  it('returns nothing on an error status, a bad body, or a network failure', async () => {
    expect(await detectAtprotoAppsForRepo({ pds: 'https://pds.test', did: DID, fetch: pds([], 500) })).toEqual([])
    expect(await detectAtprotoAppsForRepo({ pds: 'https://pds.test', did: DID, fetch: pds('nope') })).toEqual([])
    const boom = (async () => { throw new Error('down') }) as unknown as typeof fetch
    expect(await detectAtprotoAppsForRepo({ pds: 'https://pds.test', did: DID, fetch: boom })).toEqual([])
  })
})
