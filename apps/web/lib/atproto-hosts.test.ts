import { describe, expect, it } from 'vitest'
import { restoreBlueskyAvatar, setBlueskyAvatar } from './bsky-profile'
import { restorePreviousBlueskyAvatar, useAsBlueskyAvatar, type SyncDeps } from './bsky-sync'
import { memorySyncStore } from './bsky-sync-store'
import { mockHomeServer, testJpeg } from './bsky-test-server'
import type { OAuthSession } from '@atproto/oauth-client-node'
import { fetchBlueskyAvatar, type StoredImage } from './repo'

/**
 * Issue #246: the avatar write, restore, and import go through the session's own server (the one in the
 * person's DID document), never to a fixed Bluesky host. The mock reports every origin a call used.
 */
const THIRD_PARTY = 'https://pds.selfhosted.example'
const OLD = { $type: 'blob' as const, ref: { $link: 'oldavatarcid1234' }, mimeType: 'image/jpeg', size: 10 }
const PROFILE = { $type: 'app.bsky.actor.profile', displayName: 'Alice', avatar: OLD }

function host() {
  const h = mockHomeServer({ did: 'did:web:alice.example', serverUrl: THIRD_PARTY, profile: PROFILE })
  return h
}
const noBluesky = (origins: Set<string>) => {
  expect([...origins]).toEqual([THIRD_PARTY])
  for (const o of origins) expect(o).not.toMatch(/bsky/i)
}

describe('accounts on a non-Bluesky server', () => {
  it('sync writes only to the home server', async () => {
    const h = host()
    h.putBlob('oldavatarcid1234', await testJpeg(50, 50))
    const src = h.putBlob('srccid12345678', await testJpeg(400, 400))
    const image: StoredImage = { uri: 'at://did:web:alice.example/com.blueyvatar.image/a', cid: 'r', rkey: 'a', value: { image: src, isDefault: true, createdAt: '2024-01-01T00:00:00.000Z' } }
    const deps: SyncDeps = { store: memorySyncStore(), limit: async () => null }
    const out = await useAsBlueskyAvatar(h.server, image, deps)
    expect(out).toMatchObject({ ok: true, changed: true })
    expect(h.writes()).toHaveLength(1)
    noBluesky(h.origins)
    expect(out.message).not.toMatch(/bluesky/i)
  })

  it('restore writes only to the home server', async () => {
    const h = host()
    h.putBlob('oldavatarcid1234', await testJpeg(50, 50))
    const set = await setBlueskyAvatar(h.server, { bytes: await testJpeg(300, 300) })
    expect(set.ok).toBe(true)
    expect((await restoreBlueskyAvatar(h.server, OLD)).ok).toBe(true)
    noBluesky(h.origins)
  })

  it('the undo button path also stays on the home server and its messages name no brand', async () => {
    const h = host()
    const store = memorySyncStore()
    const out = await restorePreviousBlueskyAvatar(h.server, { store, limit: async () => null })
    expect(out.ok).toBe(false)
    expect(out.message).not.toMatch(/bluesky/i)
    const { BSKY_MESSAGES } = await import('./bsky-profile')
    for (const m of Object.values(BSKY_MESSAGES)) expect(m).not.toMatch(/bluesky/i)
  })

  it('import reads the profile and the blob only from the home server', async () => {
    const cid = 'bafkreiavatarcid1'
    const h = mockHomeServer({ did: 'did:web:alice.example', serverUrl: THIRD_PARTY, profile: { ...PROFILE, avatar: { $type: 'blob', ref: { $link: cid }, mimeType: 'image/jpeg', size: 100 } } })
    h.putBlob(cid, await testJpeg(100, 100))
    const got = await fetchBlueskyAvatar(h.server as unknown as OAuthSession)
    expect(got.mime).toBe('image/jpeg')
    noBluesky(h.origins)
  })

  it('a missing profile record gives the plain message and writes nothing', async () => {
    const h = mockHomeServer({ did: 'did:web:alice.example', serverUrl: THIRD_PARTY, profile: null })
    const r = await setBlueskyAvatar(h.server, { bytes: await testJpeg(300, 300) })
    expect(r).toMatchObject({ ok: false, code: 'no_profile' })
    expect(h.writes()).toHaveLength(0)
    noBluesky(h.origins)
  })
})
