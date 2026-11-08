import { describe, expect, it } from 'vitest'
import { BSKY_MESSAGES } from './bsky-profile'
import { ALREADY_MATCHES_MESSAGE, FIRST_AUTO_NOTICE, RATING_BLOCKED_MESSAGE, bskyBlockReason, restorePreviousBlueskyAvatar, syncAfterDefaultChange, syncsAfterImport, useAsBlueskyAvatar, type SyncDeps } from './bsky-sync'
import { memorySyncStore } from './bsky-sync-store'
import { mockHomeServer, testJpeg } from './bsky-test-server'
import type { StoredImage } from './repo'

const OLD = { $type: 'blob' as const, ref: { $link: 'old-avatar' }, mimeType: 'image/jpeg', size: 10 }
const PROFILE = { $type: 'app.bsky.actor.profile', displayName: 'Alice', avatar: OLD, createdAt: '2024-01-01T00:00:00.000Z' }

async function setup(opts: { scope?: string; labels?: string[]; isDefault?: boolean } = {}) {
  const h = mockHomeServer({ profile: PROFILE, ...(opts.scope !== undefined ? { scope: opts.scope } : {}) })
  h.putBlob('old-avatar', await testJpeg(50, 50))
  const blob = h.putBlob('src-1', await testJpeg(500, 500))
  const image: StoredImage = {
    uri: 'at://did:plc:alice/com.blueyvatar.image/a',
    cid: 'rec-1',
    rkey: 'a',
    value: {
      image: blob,
      isDefault: opts.isDefault ?? true,
      createdAt: '2024-01-01T00:00:00.000Z',
      ...(opts.labels ? { labels: { $type: 'com.atproto.label.defs#selfLabels', values: opts.labels.map((val) => ({ val })) } } : {}),
    },
  }
  const store = memorySyncStore()
  let limitMsg: string | null = null
  const deps: SyncDeps = { store, limit: async () => limitMsg }
  return { h, image, store, deps, limitWith: (m: string | null) => (limitMsg = m) }
}

describe('useAsBlueskyAvatar', () => {
  it('updates the avatar, keeps the other fields, and writes an audit row', async () => {
    const { h, image, store, deps } = await setup()
    const out = await useAsBlueskyAvatar(h.server, image, deps)
    expect(out).toMatchObject({ ok: true, changed: true })
    expect(h.profile()!.value).toMatchObject({ displayName: 'Alice', createdAt: PROFILE.createdAt })
    expect(h.writes()).toHaveLength(1)
    const log = await store.log('did:plc:alice')
    expect(log).toEqual([expect.objectContaining({ action: 'set', fromCid: 'old-avatar', sourceCid: 'src-1' })])
  })

  it('blocks R and X images and writes nothing', async () => {
    for (const val of ['sexual', 'graphic-media', 'porn']) {
      const { h, image, deps } = await setup({ labels: [val] })
      expect(bskyBlockReason(image)).toBe(RATING_BLOCKED_MESSAGE)
      expect(await useAsBlueskyAvatar(h.server, image, deps)).toEqual({ ok: false, changed: false, message: RATING_BLOCKED_MESSAGE })
      expect(h.writes()).toHaveLength(0)
    }
    const pg = await setup({ labels: ['nudity'] })
    expect(bskyBlockReason(pg.image)).toBeNull()
    expect(await useAsBlueskyAvatar(pg.h.server, pg.image, pg.deps)).toMatchObject({ ok: true, changed: true })
  })

  it('asks the user to sign in again when the permission was never granted', async () => {
    for (const scope of ['atproto blob:image/*', 'atproto repo:app.bsky.actor.profile?action=create']) {
      const { h, image, deps } = await setup({ scope })
      expect(await useAsBlueskyAvatar(h.server, image, deps)).toEqual({ ok: false, changed: false, message: BSKY_MESSAGES.no_permission })
      expect(h.calls).toHaveLength(0)
    }
  })

  it('does not write the same picture twice', async () => {
    const { h, image, deps } = await setup()
    await useAsBlueskyAvatar(h.server, image, deps)
    const again = await useAsBlueskyAvatar(h.server, image, deps)
    expect(again).toEqual({ ok: true, changed: false, message: ALREADY_MATCHES_MESSAGE })
    expect(h.writes()).toHaveLength(1)
  })

  it('sends the picture again after Bluesky was changed elsewhere', async () => {
    const { h, image, deps } = await setup()
    await useAsBlueskyAvatar(h.server, image, deps)
    h.editElsewhere({ avatar: OLD })
    expect(await useAsBlueskyAvatar(h.server, image, deps)).toMatchObject({ ok: true, changed: true })
  })

  it('stops at the per-account limit before writing', async () => {
    const { h, image, deps, limitWith } = await setup()
    limitWith('Too many requests. Try again in 1 hour.')
    expect(await useAsBlueskyAvatar(h.server, image, deps)).toMatchObject({ ok: false, message: 'Too many requests. Try again in 1 hour.' })
    expect(h.writes()).toHaveLength(0)
  })

  it('reports a version conflict and keeps the profile as the user left it', async () => {
    const { h, image, deps } = await setup()
    const orig = h.server.fetchHandler.bind(h.server)
    h.server.fetchHandler = async (p, init) => {
      if (p.includes('uploadBlob')) h.editElsewhere({ displayName: 'Alice B' })
      return orig(p, init)
    }
    const out = await useAsBlueskyAvatar(h.server, image, deps)
    expect(out).toMatchObject({ ok: false, message: BSKY_MESSAGES.conflict })
    expect(h.profile()!.value).toMatchObject({ displayName: 'Alice B', avatar: OLD })
  })
})

describe('undo', () => {
  it('restores the previous blob', async () => {
    const { h, image, store, deps } = await setup()
    await useAsBlueskyAvatar(h.server, image, deps)
    expect((await store.get('did:plc:alice')).previous).toEqual(OLD)
    const out = await restorePreviousBlueskyAvatar(h.server, deps)
    expect(out).toMatchObject({ ok: true, changed: true })
    expect(h.profile()!.value).toEqual(PROFILE)
    expect((await store.get('did:plc:alice')).previous).toBeUndefined()
    expect((await store.log('did:plc:alice')).map((l) => l.action)).toEqual(['set', 'restore'])
  })

  it('has nothing to restore before any change, and writes nothing', async () => {
    const { h, deps } = await setup()
    expect(await restorePreviousBlueskyAvatar(h.server, deps)).toMatchObject({ ok: false })
    expect(h.writes()).toHaveLength(0)
  })
})

describe('automatic sync', () => {
  it('follows the default image and announces the first automatic change', async () => {
    const { h, image, store, deps } = await setup()
    const note = await syncAfterDefaultChange(h.server, image, deps)
    expect(note).toBe(FIRST_AUTO_NOTICE)
    expect(h.writes()).toHaveLength(1)
    expect((await store.get('did:plc:alice')).autoNoticePending).toBe(true)
    expect((await store.log('did:plc:alice'))[0]!.action).toBe('auto_set')
  })

  it('does nothing when the switch is off or permission is missing', async () => {
    const off = await setup()
    await off.store.setAutoSync('did:plc:alice', false)
    expect(await syncAfterDefaultChange(off.h.server, off.image, off.deps)).toBeNull()
    expect(off.h.calls).toHaveLength(0)
    const none = await setup({ scope: 'atproto blob:image/*' })
    expect(await syncAfterDefaultChange(none.h.server, none.image, none.deps)).toBeNull()
    expect(none.h.calls).toHaveLength(0)
  })

  it('leaves Bluesky unchanged for an R or X default and says why, without throwing', async () => {
    const { h, image, deps } = await setup({ labels: ['sexual'] })
    const note = await syncAfterDefaultChange(h.server, image, deps)
    expect(note).toContain(RATING_BLOCKED_MESSAGE)
    expect(h.writes()).toHaveLength(0)
  })

  it('a failed sync returns a note and never throws', async () => {
    const { h, image, deps } = await setup()
    h.server.fetchHandler = async () => {
      throw new TypeError('fetch failed')
    }
    const note = await syncAfterDefaultChange(h.server, image, deps)
    expect(note).toContain('did not')
  })

  it('writes nothing when the default came from importing the Bluesky avatar', async () => {
    expect(syncsAfterImport('bluesky', true)).toBe(false)
    expect(syncsAfterImport('gravatar', true)).toBe(true)
    expect(syncsAfterImport('gravatar', false)).toBe(false)
    // The import action then makes no home server call at all, and an imported copy of the picture Bluesky already shows is skipped if sent.
    const { h, image, deps } = await setup()
    h.editElsewhere({ avatar: image.value.image })
    expect(await useAsBlueskyAvatar(h.server, image, deps)).toEqual({ ok: true, changed: false, message: ALREADY_MATCHES_MESSAGE })
    expect(h.writes()).toHaveLength(0)
  })
})
