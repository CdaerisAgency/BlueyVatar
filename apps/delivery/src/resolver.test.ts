import { describe, expect, it } from 'vitest'
import { DEFAULT_ADAPTERS } from '@blueyvatar/core'
import { AtprotoResolver, type Identity } from './resolver.js'
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
    reads++
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
