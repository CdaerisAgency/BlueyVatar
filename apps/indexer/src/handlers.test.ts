import { describe, expect, it, vi } from 'vitest'
import { handleRecord, type IndexWrites } from './handlers.js'

function fakeDb(): IndexWrites {
  return {
    upsertImage: vi.fn(), deleteImage: vi.fn(), upsertProfile: vi.fn(), deleteProfile: vi.fn(),
    upsertClaim: vi.fn(), deleteClaim: vi.fn(), setRepoStatus: vi.fn(), purgeImages: vi.fn(),
  } as unknown as IndexWrites
}

describe('indexer handlers', () => {
  it('indexes an image with its rating', async () => {
    const db = fakeDb()
    await handleRecord({
      did: 'did:plc:a', collection: 'com.blueyvatar.image', rkey: '3k', action: 'create',
      record: {
        image: { $type: 'blob', ref: { $link: 'bafyimg' }, mimeType: 'image/png', size: 100 },
        labels: { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'nudity' }] },
        isDefault: true, createdAt: '2026-11-03T00:00:00Z',
      },
    }, db)
    expect(db.upsertImage).toHaveBeenCalledWith(expect.objectContaining({ cid: 'bafyimg', rating: 'pg', isDefault: true }))
  })
  it('deletes and purges on image delete', async () => {
    const db = fakeDb()
    await handleRecord({ did: 'did:plc:a', collection: 'com.blueyvatar.image', rkey: '3k', action: 'delete' }, db)
    expect(db.deleteImage).toHaveBeenCalledWith('did:plc:a', '3k')
    expect(db.purgeImages).toHaveBeenCalledWith('did:plc:a', undefined)
  })
  it('purges indexed images and the Bluesky avatar when the profile changes, so a label change takes effect', async () => {
    const db = fakeDb()
    await handleRecord({
      did: 'did:plc:a', collection: 'app.bsky.actor.profile', rkey: 'self', action: 'update',
      record: {
        avatar: { $type: 'blob', ref: { $link: 'bafyavatar' }, mimeType: 'image/jpeg', size: 10 },
        labels: { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: '!no-unauthenticated' }] },
      },
    }, db)
    expect(db.purgeImages).toHaveBeenCalledWith('did:plc:a')
    expect(db.purgeImages).toHaveBeenCalledWith('did:plc:a', ['bafyavatar'])
  })
  it('purges once when the Bluesky profile is deleted', async () => {
    const db = fakeDb()
    await handleRecord({ did: 'did:plc:a', collection: 'app.bsky.actor.profile', rkey: 'self', action: 'delete' }, db)
    expect(db.purgeImages).toHaveBeenCalledTimes(1)
  })
})
