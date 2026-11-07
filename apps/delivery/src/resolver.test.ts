import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_ADAPTERS, pickCandidate } from '@blueyvatar/core'
import { AVATAR_TOO_LARGE_LOG, AtprotoResolver, NO_RECORD_TTL_MS, type Identity } from './resolver.js'
import { MemoryIndexStore } from './store.js'

const ident: Identity = { did: 'did:plc:abc123', handle: 'alice.test', pds: 'https://pds.test' }
const avatar = { $type: 'blob', ref: { $link: 'bafyreiabc123' }, mimeType: 'image/jpeg', size: 10 }
const serviceImage = { rkey: '1', cid: 'bafyother', mimeType: 'image/png', rating: 'g' as const, isDefault: false, createdAt: '2026-11-01T00:00:00Z' }

function labels(...vals: string[]) {
  return { $type: 'com.atproto.label.defs#selfLabels', values: vals.map((val) => ({ val })) }
}

function resolverFor(profile: Record<string, unknown> | 'error') {
  const index = new MemoryIndexStore()
  let reads = 0
  const fetch = (async (url: URL) => {
    if (url.searchParams.get('collection') === 'app.bsky.actor.profile') reads++
    if (profile === 'error') return new Response('boom', { status: 500 })
    return Response.json({ value: url.searchParams.get('collection') === 'app.bsky.actor.profile' ? profile : undefined })
  }) as unknown as typeof globalThis.fetch
  return { resolver: new AtprotoResolver({ index, adapters: DEFAULT_ADAPTERS, fetch }), reads: () => reads, index }
}

describe('AtprotoResolver !no-unauthenticated label', () => {
  it('returns the Bluesky avatar when no label is set', async () => {
    const { resolver } = resolverFor({ avatar })
    expect((await resolver.candidates(ident)).map((c) => c.source)).toEqual(['adapter:bluesky'])
  })

  it('keeps ordinary labels as ratings', async () => {
    const { resolver } = resolverFor({ avatar, labels: labels('nudity') })
    expect((await resolver.candidates(ident)).map((c) => c.rating)).toEqual(['pg'])
  })

  it('returns no candidates for a labeled profile, service images included', async () => {
    const { resolver, index } = resolverFor({ avatar, labels: labels('nudity', '!no-unauthenticated') })
    index.images.set(ident.did, [serviceImage])
    expect(await resolver.candidates(ident)).toEqual([])
  })

  it('hides everything when the profile read fails', async () => {
    const { resolver, index } = resolverFor('error')
    index.images.set(ident.did, [serviceImage])
    expect(await resolver.candidates(ident)).toEqual([])
  })

  it('reads the Bluesky profile once per lookup', async () => {
    const { resolver, reads } = resolverFor({ avatar })
    await resolver.candidates(ident)
    expect(reads()).toBe(1)
  })
})

// Record shapes seen in live repos on Nov 7, 2026 (docs/research/tangled-collection-v1.md).
// DIDs and CIDs are fake. Key order and field names match the live records.
const tangledBlob = (cid: string, mimeType: string, size: number) =>
  ({ ref: { $link: cid }, size, $type: 'blob', mimeType })
const newRecord = {
  $type: 'org.tangled.actor.profile',
  avatar: tangledBlob('bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'image/jpeg', 44622),
  createdAt: '2026-05-15T10:22:23.134907Z',
}
const newRecordNoAvatar = { $type: 'org.tangled.actor.profile' }
const legacyRecord = {
  $type: 'sh.tangled.actor.profile',
  links: ['https://example.com/me', '', '', '', ''],
  stats: ['star-count', 'merged-pull-request-count'],
  avatar: tangledBlob('bafkreibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'image/png', 18520),
  bluesky: false,
  location: 'Austin, TX',
  pronouns: 'he/him',
  description: 'hello',
  preferredHandle: '',
}

function tangledResolver(records: Record<string, Record<string, unknown> | 'error'>) {
  const reads: string[] = []
  const fetch = (async (url: URL) => {
    const collection = url.searchParams.get('collection') ?? ''
    reads.push(collection)
    const rec = records[collection]
    if (rec === 'error') return new Response('boom', { status: 500 })
    // The PDS answers 400 RecordNotFound for a missing record.
    return rec ? Response.json({ value: rec }) : new Response('{"error":"RecordNotFound"}', { status: 400 })
  }) as unknown as typeof globalThis.fetch
  const resolver = new AtprotoResolver({ index: new MemoryIndexStore(), adapters: DEFAULT_ADAPTERS, fetch, maxRetries: 0 })
  return { resolver, reads }
}

describe('Tangled adapters', () => {
  const bsky = 'app.bsky.actor.profile'
  const org = 'org.tangled.actor.profile'
  const sh = 'sh.tangled.actor.profile'

  it('reads the new collection and skips the legacy read when the new record exists', async () => {
    const { resolver, reads } = tangledResolver({ [org]: newRecord, [sh]: legacyRecord })
    const cands = await resolver.candidates(ident)
    expect(cands.map((c) => [c.source, c.blob.cid, c.blob.mimeType])).toEqual([
      ['adapter:tangled', newRecord.avatar.ref.$link, 'image/jpeg'],
    ])
    expect(reads.sort()).toEqual([bsky, org, sh].sort())
  })

  it('falls back to the legacy collection only when the new record is missing', async () => {
    const { resolver, reads } = tangledResolver({ [sh]: legacyRecord })
    const cands = await resolver.candidates(ident)
    expect(cands.map((c) => [c.source, c.blob.cid, c.blob.mimeType])).toEqual([
      ['adapter:tangled-legacy', legacyRecord.avatar.ref.$link, 'image/png'],
    ])
    expect(reads).toEqual([bsky, org, sh])
  })

  it('does not fall back when the new record exists without an avatar', async () => {
    const { resolver, reads } = tangledResolver({ [org]: newRecordNoAvatar, [sh]: legacyRecord })
    expect(await resolver.candidates(ident)).toEqual([])
    expect(reads.sort()).toEqual([bsky, org, sh].sort())
  })

  it('returns nothing when neither collection has a record', async () => {
    const { resolver } = tangledResolver({})
    expect(await resolver.candidates(ident)).toEqual([])
  })

  it('skips an adapter that errors, and does not treat the error as a missing record', async () => {
    const { resolver, reads } = tangledResolver({ [org]: 'error', [sh]: legacyRecord })
    const cands = await resolver.candidates(ident)
    expect(reads.sort()).toEqual([bsky, org, sh].sort())
    expect(cands).toEqual([])
  })

  it('ignores avatar types outside the accept list', async () => {
    const gif = { ...newRecord, avatar: tangledBlob('bafkreiccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'image/gif', 10) }
    const { resolver } = tangledResolver({ [org]: gif })
    expect(await resolver.candidates(ident)).toEqual([])
  })
})

describe('Tangled adapter performance', () => {
  const org = 'org.tangled.actor.profile'
  const sh = 'sh.tangled.actor.profile'

  /** Fake fetch where each Tangled read takes `delayMs` of fake time. Tracks overlap. */
  function timed(records: Record<string, Record<string, unknown> | 'error'>, delayMs: number, logs: unknown[][] = []) {
    const state = { inFlight: 0, maxInFlight: 0, calls: [] as string[] }
    const fetch = (async (url: URL) => {
      const collection = url.searchParams.get('collection') ?? ''
      state.calls.push(collection)
      const tangled = collection.endsWith('tangled.actor.profile')
      if (tangled) {
        state.inFlight++
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
        await new Promise((r) => setTimeout(r, delayMs))
        state.inFlight--
      }
      const rec = records[collection]
      if (rec === 'error') return new Response('boom', { status: 500 })
      return rec ? Response.json({ value: rec }) : new Response('{"error":"RecordNotFound"}', { status: 400 })
    }) as unknown as typeof globalThis.fetch
    const resolver = new AtprotoResolver({
      index: new MemoryIndexStore(), adapters: DEFAULT_ADAPTERS, fetch, maxRetries: 0,
      log: (...a) => { logs.push(a) },
    })
    return { resolver, state, logs }
  }

  it('reads both Tangled collections in parallel and keeps priority order', async () => {
    vi.useFakeTimers()
    try {
      const { resolver, state } = timed({ [org]: newRecord, [sh]: legacyRecord }, 100)
      let done = false
      const p = resolver.candidates(ident).then((c) => { done = true; return c })
      await vi.advanceTimersByTimeAsync(100)
      // Sequential reads would need 200 ms of fake time.
      expect(done).toBe(true)
      expect(state.maxInFlight).toBe(2)
      expect((await p).map((c) => c.source)).toEqual(['adapter:tangled'])
    } finally { vi.useRealTimers() }
  })

  it('uses the legacy result when the new record is missing, even if legacy answers first', async () => {
    const { resolver } = timed({ [sh]: legacyRecord }, 1)
    expect((await resolver.candidates(ident)).map((c) => c.source)).toEqual(['adapter:tangled-legacy'])
  })

  it('does not hit the PDS again for a cached "no record"', async () => {
    const { resolver, state } = timed({}, 1)
    await resolver.candidates(ident)
    const first = state.calls.filter((c) => c.endsWith('tangled.actor.profile')).length
    expect(first).toBe(2)
    await resolver.candidates(ident)
    expect(state.calls.filter((c) => c.endsWith('tangled.actor.profile')).length).toBe(2)
  })

  it('expires the no-record entry after the TTL and caps its size', async () => {
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const { resolver, state } = timed({}, 0)
      await resolver.candidates(ident)
      now += NO_RECORD_TTL_MS + 1
      await resolver.candidates(ident)
      expect(state.calls.filter((c) => c === org).length).toBe(2)
      const small = new AtprotoResolver({ index: new MemoryIndexStore(), adapters: DEFAULT_ADAPTERS, noRecordMax: 1, maxRetries: 0, fetch: (async () => new Response('{}', { status: 400 })) as unknown as typeof globalThis.fetch })
      await small.candidates(ident)
      expect(small['noRecord']['m'].size).toBe(1)
    } finally { vi.restoreAllMocks() }
  })

  it('does not cache errors, and always re-reads the Bluesky profile', async () => {
    const { resolver, state } = timed({ [org]: 'error' }, 0)
    await resolver.candidates(ident)
    await resolver.candidates(ident)
    expect(state.calls.filter((c) => c === org).length).toBe(2)
    expect(state.calls.filter((c) => c === 'app.bsky.actor.profile').length).toBe(2)
  })

  it('keeps a cached miss per DID', async () => {
    const { resolver, state } = timed({}, 0)
    await resolver.candidates(ident)
    await resolver.candidates({ ...ident, did: 'did:plc:other' })
    expect(state.calls.filter((c) => c === org).length).toBe(2)
  })

  it('treats a Tangled avatar over 1,000,000 bytes as no avatar and logs a fixed message', async () => {
    const big = { ...newRecord, avatar: tangledBlob('bafkreibigbigbigbigbigbigbigbigbigbigbigbigbigbigbigbigbigbigb', 'image/png', 2_533_667) }
    const { resolver, logs } = timed({ [org]: big, [sh]: legacyRecord }, 0)
    expect(await resolver.candidates(ident)).toEqual([])
    expect(logs.filter(([m]) => m === AVATAR_TOO_LARGE_LOG)).toHaveLength(1)
    expect(AVATAR_TOO_LARGE_LOG).toBe('adapter avatar over size limit')
  })

  it('accepts an avatar of exactly 1,000,000 bytes and one with no declared size', async () => {
    const edge = { ...newRecord, avatar: tangledBlob('bafkreiedgeedgeedgeedgeedgeedgeedgeedgeedgeedgeedgeedgeedgeed', 'image/png', 1_000_000) }
    expect((await timed({ [org]: edge }, 0).resolver.candidates(ident)).length).toBe(1)
    const { size: _s, ...noSize } = newRecord.avatar
    expect((await timed({ [org]: { ...newRecord, avatar: noSize } }, 0).resolver.candidates(ident)).length).toBe(1)
  })
})

describe('gallery images', () => {
  const gallery = { rkey: 'g', cid: 'bafygallery', mimeType: 'image/png', rating: 'g' as const, isDefault: false, purpose: 'gallery', caption: 'Hi', sort: 1, createdAt: '2026-12-01T00:00:00Z' }

  it('never becomes the avatar, even when it is the newest or the default', async () => {
    const { resolver, index } = resolverFor({ avatar })
    index.images.set(ident.did, [gallery, { ...gallery, rkey: 'g2', cid: 'bafygallery2', isDefault: true }, serviceImage])
    const cands = await resolver.candidates(ident)
    expect(cands.map((c) => c.blob.cid)).toEqual(['bafyother', 'bafyreiabc123'])
    expect(pickCandidate(cands, 'g', false)).toMatchObject({ kind: 'image', candidate: { blob: { cid: 'bafyother' } } })
  })

  it('leaves a gallery-only account on the default avatar', async () => {
    const { resolver, index } = resolverFor({})
    index.images.set(ident.did, [gallery])
    expect(pickCandidate(await resolver.candidates(ident), 'g', false)).toEqual({ kind: 'default' })
  })

  it('treats a record without purpose as an avatar and an unknown purpose as neither', async () => {
    const { resolver, index } = resolverFor({})
    index.images.set(ident.did, [serviceImage, { ...gallery, purpose: 'banner' }])
    expect((await resolver.candidates(ident)).map((c) => c.blob.cid)).toEqual(['bafyother'])
    expect(await resolver.galleryItems(ident)).toEqual([])
  })

  it('lists gallery items in order and skips blocked images', async () => {
    const { resolver, index } = resolverFor({})
    index.images.set(ident.did, [{ ...gallery, rkey: 'b', cid: 'bafyb', sort: 2 }, gallery, { ...gallery, rkey: 'c', cid: 'bafyc', sort: 3 }])
    index.blocked.add(`${ident.did}/bafyb`)
    expect(await resolver.galleryItems(ident)).toEqual([
      { cid: 'bafygallery', rating: 'g', caption: 'Hi' },
      { cid: 'bafyc', rating: 'g', caption: 'Hi' },
    ])
  })

  it('hides the gallery for a labeled account and when the profile read fails', async () => {
    const labeled = resolverFor({ labels: labels('!no-unauthenticated') })
    labeled.index.images.set(ident.did, [gallery])
    expect(await labeled.resolver.galleryItems(ident)).toEqual([])
    const broken = resolverFor('error')
    broken.index.images.set(ident.did, [gallery])
    expect(await broken.resolver.galleryItems(ident)).toEqual([])
  })
})
