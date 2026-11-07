import { describe, expect, it } from 'vitest'
import { DEFAULT_ADAPTERS } from '@blueyvatar/core'
import { AtprotoResolver, type Identity } from './resolver.js'
import { MemoryIndexStore } from './store.js'
import { imageUri, labelBlocksBlob } from './label-block.js'

const ident: Identity = { did: 'did:plc:abc123', handle: 'alice.test', pds: 'https://pds.test' }
const img = (rkey: string, cid: string, extra = {}) => ({ rkey, cid, mimeType: 'image/png', rating: 'g' as const, isDefault: false, createdAt: '2026-11-01T00:00:00Z', ...extra })

function setup() {
  const index = new MemoryIndexStore()
  const fetch = (async () => Response.json({ value: undefined })) as unknown as typeof globalThis.fetch
  return { index, resolver: new AtprotoResolver({ index, adapters: DEFAULT_ADAPTERS, fetch }) }
}

describe('label enforcement in delivery (issue #207)', () => {
  it('stops serving an account labeled !takedown, !suspend, or !hide', async () => {
    for (const val of ['!takedown', '!suspend', '!hide']) {
      const { index, resolver } = setup()
      index.images.set(ident.did, [img('1', 'bafya')])
      index.labels.set(ident.did, [{ subject: ident.did, val }])
      expect(await resolver.candidates(ident)).toEqual([])
      expect(await labelBlocksBlob(index, ident.did, 'bafya')).toBe(true)
    }
  })

  it('skips only the labeled record', async () => {
    const { index, resolver } = setup()
    index.images.set(ident.did, [img('1', 'bafya'), img('2', 'bafyb')])
    index.labels.set(ident.did, [{ subject: imageUri(ident.did, '1'), val: '!takedown' }])
    expect((await resolver.candidates(ident)).map((c) => c.blob.cid)).toEqual(['bafyb'])
    expect(await labelBlocksBlob(index, ident.did, 'bafya')).toBe(true)
    expect(await labelBlocksBlob(index, ident.did, 'bafyb')).toBe(false)
  })

  it('raises the rating from porn, sexual, nudity, graphic-media and never lowers it', async () => {
    const { index, resolver } = setup()
    index.images.set(ident.did, [img('1', 'bafya'), img('2', 'bafyb', { rating: 'x' as const }), img('3', 'bafyc'), img('4', 'bafyd')])
    index.labels.set(ident.did, [
      { subject: imageUri(ident.did, '1'), val: 'porn' },
      { subject: imageUri(ident.did, '2'), val: 'nudity' },
      { subject: imageUri(ident.did, '3'), val: 'graphic-media' },
    ])
    const byCid = Object.fromEntries((await resolver.candidates(ident)).map((c) => [c.blob.cid, c.rating]))
    expect(byCid).toEqual({ bafya: 'x', bafyb: 'x', bafyc: 'r', bafyd: 'g' })
  })

  it('applies an account-level rating label to every image and to gallery items', async () => {
    const { index, resolver } = setup()
    index.images.set(ident.did, [img('1', 'bafya'), img('g', 'bafyg', { purpose: 'gallery' })])
    index.labels.set(ident.did, [{ subject: ident.did, val: 'sexual' }])
    expect((await resolver.candidates(ident)).map((c) => c.rating)).toEqual(['r'])
    expect((await resolver.galleryItems(ident)).map((g) => g.rating)).toEqual(['r'])
  })

  it('ignores labels it does not enforce', async () => {
    const { index, resolver } = setup()
    index.images.set(ident.did, [img('1', 'bafya')])
    index.labels.set(ident.did, [{ subject: ident.did, val: 'bot' }])
    expect((await resolver.candidates(ident)).map((c) => c.rating)).toEqual(['g'])
  })
})
