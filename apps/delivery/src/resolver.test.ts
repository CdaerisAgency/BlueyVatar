import { describe, expect, it } from 'vitest'
import { DEFAULT_ADAPTERS, pickCandidate } from '@blueyvatar/core'
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
