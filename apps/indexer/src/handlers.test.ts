import { describe, expect, it, vi } from 'vitest'
import { handleRecord, type IndexWrites } from './handlers.js'

function fakeDb(): IndexWrites {
  return {
    upsertImage: vi.fn(), deleteImage: vi.fn(), upsertProfile: vi.fn(), deleteProfile: vi.fn(),
    upsertClaim: vi.fn(), deleteClaim: vi.fn(), upsertProfileLink: vi.fn(), deleteProfileLink: vi.fn(), setRepoStatus: vi.fn(), purgeImages: vi.fn(),
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
  it('indexes purpose, caption, and sort, and treats a missing purpose as avatar', async () => {
    const db = fakeDb()
    const image = { $type: 'blob', ref: { $link: 'bafygal' }, mimeType: 'image/png', size: 100 }
    await handleRecord({
      did: 'did:plc:a', collection: 'com.blueyvatar.image', rkey: 'g1', action: 'create',
      record: { image, purpose: 'gallery', caption: 'Hello', sort: 2, createdAt: '2026-11-03T00:00:00Z' },
    }, db)
    expect(db.upsertImage).toHaveBeenLastCalledWith(expect.objectContaining({ purpose: 'gallery', caption: 'Hello', sort: 2 }))
    await handleRecord({ did: 'did:plc:a', collection: 'com.blueyvatar.image', rkey: 'a1', action: 'create', record: { image, createdAt: '2026-11-03T00:00:00Z' } }, db)
    expect(db.upsertImage).toHaveBeenLastCalledWith(expect.objectContaining({ purpose: 'avatar', caption: null, sort: null }))
    await handleRecord({ did: 'did:plc:a', collection: 'com.blueyvatar.image', rkey: 'g2', action: 'create', record: { image, purpose: 'gallery', caption: 'x'.repeat(200), sort: 1.5, createdAt: '2026-11-03T00:00:00Z' } }, db)
    const last = (db.upsertImage as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]
    expect(last.caption).toHaveLength(140)
    expect(last.sort).toBeNull()
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
  it('indexes link records with their CID and deletes them', async () => {
    const db = fakeDb()
    await handleRecord({
      did: 'did:plc:a', collection: 'app.bsky.actor.link', rkey: '3l', cid: 'bafylink', action: 'create',
      record: { url: 'https://a.test/', title: 'A', createdAt: '2026-11-03T00:00:00Z' },
    }, db)
    expect(db.upsertProfileLink).toHaveBeenCalledWith({ did: 'did:plc:a', rkey: '3l', cid: 'bafylink', url: 'https://a.test/', title: 'A', createdAt: '2026-11-03T00:00:00Z' })
    await handleRecord({ did: 'did:plc:a', collection: 'app.bsky.actor.link', rkey: '3l', action: 'delete' }, db)
    expect(db.deleteProfileLink).toHaveBeenCalledWith('did:plc:a', '3l')
  })
})
