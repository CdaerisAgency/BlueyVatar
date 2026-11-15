import { describe, expect, it } from 'vitest'
import { pushApp } from './push-apps'
import { pushMessages } from './push-profile'
import { ALREADY_MATCHES_MESSAGE, disableApp, enableApp, RATING_BLOCKED_MESSAGE, firstAutoNotice, pushBlockReason, pushToApp, restorePrevious, syncAfterDefaultChange, syncsAfterImport, type SyncDeps } from './push-sync'
import { memoryPushStore } from './push-store'
import { mockHomeServer, testJpeg } from './push-test-server'
import type { StoredImage } from './repo'

const BSKY = pushApp('bluesky')!
const TANGLED = pushApp('tangled')!
const BSKY_MESSAGES = pushMessages(BSKY)
const FIRST_AUTO_NOTICE = firstAutoNotice(BSKY)
const DID = 'did:plc:alice'

const OLD = { $type: 'blob' as const, ref: { $link: 'old-avatar' }, mimeType: 'image/jpeg', size: 10 }
const PROFILE = { $type: 'app.bsky.actor.profile', displayName: 'Alice', avatar: OLD, createdAt: '2024-01-01T00:00:00.000Z' }

async function setupNoProfile() {
  const h = mockHomeServer({ profile: null })
  const blob = h.putBlob('src-1', await testJpeg(500, 500))
  const image: StoredImage = { uri: 'at://did:plc:alice/com.blueyvatar.image/a', cid: 'rec-1', rkey: 'a', value: { image: blob, isDefault: true, createdAt: '2024-01-01T00:00:00.000Z' } }
  const store = memoryPushStore()
  return { h, image, store, deps: { store, limit: async () => null } as SyncDeps }
}

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
  const store = memoryPushStore()
  let limitMsg: string | null = null
  const deps: SyncDeps = { store, limit: async () => limitMsg }
  return { h, image, store, deps, limitWith: (m: string | null) => (limitMsg = m) }
}

describe('pushToApp', () => {
  it('updates the avatar, keeps the other fields, and writes an audit row', async () => {
    const { h, image, store, deps } = await setup()
    const out = await pushToApp(h.server, BSKY, image, deps)
    expect(out).toMatchObject({ ok: true, changed: true })
    expect(h.profile()!.value).toMatchObject({ displayName: 'Alice', createdAt: PROFILE.createdAt })
    expect(h.writes()).toHaveLength(1)
    const log = await store.log(DID, 'bluesky')
    expect(log).toEqual([expect.objectContaining({ action: 'set', fromCid: 'old-avatar', sourceCid: 'src-1' })])
  })

  it('blocks R and X images and writes nothing', async () => {
    for (const val of ['sexual', 'graphic-media', 'porn']) {
      const { h, image, deps } = await setup({ labels: [val] })
      expect(pushBlockReason(image)).toBe(RATING_BLOCKED_MESSAGE)
      expect(await pushToApp(h.server, BSKY, image, deps)).toEqual({ ok: false, changed: false, message: RATING_BLOCKED_MESSAGE })
      expect(h.writes()).toHaveLength(0)
    }
    const pg = await setup({ labels: ['nudity'] })
    expect(pushBlockReason(pg.image)).toBeNull()
    expect(await pushToApp(pg.h.server, BSKY, pg.image, pg.deps)).toMatchObject({ ok: true, changed: true })
  })

  it('asks the user to sign in again when the permission was never granted', async () => {
    for (const scope of ['atproto blob:image/*', 'atproto repo:app.bsky.actor.profile?action=create', 'atproto repo:app.bsky.actor.profile?action=update', 'atproto repo:org.tangled.actor.profile?action=create&action=update']) {
      const { h, image, deps } = await setup({ scope })
      expect(await pushToApp(h.server, BSKY, image, deps)).toEqual({ ok: false, changed: false, message: BSKY_MESSAGES.no_permission })
      expect(h.calls).toHaveLength(0)
    }
  })

  it('does not write the same picture twice', async () => {
    const { h, image, deps } = await setup()
    await pushToApp(h.server, BSKY, image, deps)
    const again = await pushToApp(h.server, BSKY, image, deps)
    expect(again).toEqual({ ok: true, changed: false, message: ALREADY_MATCHES_MESSAGE })
    expect(h.writes()).toHaveLength(1)
  })

  it('sends the picture again after Bluesky was changed elsewhere', async () => {
    const { h, image, deps } = await setup()
    await pushToApp(h.server, BSKY, image, deps)
    h.editElsewhere({ avatar: OLD })
    expect(await pushToApp(h.server, BSKY, image, deps)).toMatchObject({ ok: true, changed: true })
  })

  it('stops at the per-account limit before writing', async () => {
    const { h, image, deps, limitWith } = await setup()
    limitWith('Too many requests. Try again in 1 hour.')
    expect(await pushToApp(h.server, BSKY, image, deps)).toMatchObject({ ok: false, message: 'Too many requests. Try again in 1 hour.' })
    expect(h.writes()).toHaveLength(0)
  })

  it('reports a version conflict and keeps the profile as the user left it', async () => {
    const { h, image, deps } = await setup()
    const orig = h.server.fetchHandler.bind(h.server)
    h.server.fetchHandler = async (p, init) => {
      if (p.includes('uploadBlob')) h.editElsewhere({ displayName: 'Alice B' })
      return orig(p, init)
    }
    const out = await pushToApp(h.server, BSKY, image, deps)
    expect(out).toMatchObject({ ok: false, message: BSKY_MESSAGES.conflict })
    expect(h.profile()!.value).toMatchObject({ displayName: 'Alice B', avatar: OLD })
  })
})

describe('undo', () => {
  it('restores the previous blob', async () => {
    const { h, image, store, deps } = await setup()
    await pushToApp(h.server, BSKY, image, deps)
    expect((await store.get(DID, 'bluesky')).previous).toEqual(OLD)
    const out = await restorePrevious(h.server, BSKY, deps)
    expect(out).toMatchObject({ ok: true, changed: true })
    expect(h.profile()!.value).toEqual(PROFILE)
    expect((await store.get(DID, 'bluesky')).previous).toBeUndefined()
    expect((await store.log(DID, 'bluesky')).map((l) => l.action)).toEqual(['set', 'restore'])
  })

  it('has nothing to restore before any change, and writes nothing', async () => {
    const { h, deps } = await setup()
    expect(await restorePrevious(h.server, BSKY, deps)).toMatchObject({ ok: false })
    expect(h.writes()).toHaveLength(0)
  })
})

describe('automatic push', () => {
  it('follows the default image once the app is on, and announces the first automatic change', async () => {
    const { h, image, store, deps } = await setup()
    await store.setEnabled(DID, 'bluesky', true)
    const note = await syncAfterDefaultChange(h.server, image, deps)
    expect(note).toBe(FIRST_AUTO_NOTICE)
    expect(h.writes()).toHaveLength(1)
    expect((await store.get(DID, 'bluesky')).autoNoticePending).toBe(true)
    expect((await store.log(DID, 'bluesky'))[0]!.action).toBe('auto_set')
  })

  it('does nothing until the user ticks the box, and not after they untick it', async () => {
    const fresh = await setup()
    expect(await syncAfterDefaultChange(fresh.h.server, fresh.image, fresh.deps)).toBeNull()
    expect(fresh.h.calls).toHaveLength(0)
    const off = await setup()
    await off.store.setEnabled(DID, 'bluesky', true)
    await off.store.setEnabled(DID, 'bluesky', false)
    expect(await syncAfterDefaultChange(off.h.server, off.image, off.deps)).toBeNull()
    expect(off.h.calls).toHaveLength(0)
  })

  it('says the picture did not change when an app is on but its permission is gone', async () => {
    const none = await setup({ scope: 'atproto blob:image/*' })
    await none.store.setEnabled(DID, 'bluesky', true)
    expect(await syncAfterDefaultChange(none.h.server, none.image, none.deps)).toContain(BSKY_MESSAGES.no_permission)
    expect(none.h.writes()).toHaveLength(0)
  })

  it('pushes only to the apps that are on', async () => {
    const { h, image, store, deps } = await setup()
    await store.setEnabled(DID, 'tangled', true)
    // The mock server holds only a Bluesky record and has no Tangled permission, so the Tangled push is refused and Bluesky is untouched.
    const note = await syncAfterDefaultChange(h.server, image, deps)
    expect(note).toContain('Tangled')
    expect(note).not.toContain('Bluesky')
    expect(h.writes()).toHaveLength(0)
  })

  it('leaves Bluesky unchanged for an R or X default and says why, without throwing', async () => {
    const { h, image, store, deps } = await setup({ labels: ['sexual'] })
    await store.setEnabled(DID, 'bluesky', true)
    const note = await syncAfterDefaultChange(h.server, image, deps)
    expect(note).toContain(RATING_BLOCKED_MESSAGE)
    expect(h.writes()).toHaveLength(0)
  })

  it('a failed sync returns a note and never throws', async () => {
    const { h, image, store, deps } = await setup()
    await store.setEnabled(DID, 'bluesky', true)
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
    expect(await pushToApp(h.server, BSKY, image, deps)).toEqual({ ok: true, changed: false, message: ALREADY_MATCHES_MESSAGE })
    expect(h.writes()).toHaveLength(0)
  })
})

describe('creating a record the user never had', () => {
  it('stops with a message and writes nothing unless the user agreed', async () => {
    const { h, image, deps } = await setupNoProfile()
    expect(await pushToApp(h.server, BSKY, image, deps)).toEqual({ ok: false, changed: false, message: BSKY_MESSAGES.no_profile })
    expect(h.writes()).toHaveLength(0)
  })

  it('creates a record with only the avatar once the user agreed', async () => {
    const { h, image, store, deps } = await setupNoProfile()
    const out = await pushToApp(h.server, BSKY, image, deps, { allowCreate: true })
    expect(out).toMatchObject({ ok: true, changed: true })
    expect(Object.keys(h.profile()!.value).sort()).toEqual(['$type', 'avatar'])
    expect((await store.get(DID, 'bluesky')).previous).toBeNull()
  })

  it('the automatic push creates one only when the user agreed when they turned the app on', async () => {
    const declined = await setupNoProfile()
    await declined.store.setEnabled(DID, 'bluesky', true)
    expect(await syncAfterDefaultChange(declined.h.server, declined.image, declined.deps)).toContain(BSKY_MESSAGES.no_profile)
    expect(declined.h.writes()).toHaveLength(0)
    const agreed = await setupNoProfile()
    await agreed.store.setEnabled(DID, 'bluesky', true, true)
    expect(await syncAfterDefaultChange(agreed.h.server, agreed.image, agreed.deps)).toBeTruthy()
    expect(Object.keys(agreed.h.profile()!.value).sort()).toEqual(['$type', 'avatar'])
  })
})

describe('enableApp and disableApp', () => {
  it('turns the app on and pushes the default image when the permission is held and the record exists', async () => {
    const { h, image, store, deps } = await setup()
    const out = await enableApp(h.server, BSKY, image, deps)
    expect(out).toMatchObject({ kind: 'enabled' })
    expect((await store.get(DID, 'bluesky')).enabled).toBe(true)
    expect(h.writes()).toHaveLength(1)
  })

  it('asks before creating a record the user never had, and changes nothing until they agree', async () => {
    const { h, image, store, deps } = await setupNoProfile()
    const asked = await enableApp(h.server, BSKY, image, deps)
    expect(asked.kind).toBe('ask_create')
    expect((await store.get(DID, 'bluesky')).enabled).toBe(false)
    expect(h.writes()).toHaveLength(0)
    const agreed = await enableApp(h.server, BSKY, image, deps, { create: true })
    expect(agreed.kind).toBe('enabled')
    expect(await store.get(DID, 'bluesky')).toMatchObject({ enabled: true, mayCreate: true })
    expect(Object.keys(h.profile()!.value).sort()).toEqual(['$type', 'avatar'])
  })

  it('does not turn anything on without the permission', async () => {
    const { h, image, store, deps } = await setup({ scope: 'atproto repo:app.bsky.actor.profile?action=update blob:image/*' })
    expect(await enableApp(h.server, BSKY, image, deps)).toEqual({ kind: 'error', message: BSKY_MESSAGES.no_permission })
    expect((await store.get(DID, 'bluesky')).enabled).toBe(false)
    expect(h.calls).toHaveLength(0)
  })

  it('turns on with no default image yet, and stays on when the first push fails', async () => {
    const none = await setup()
    expect((await enableApp(none.h.server, BSKY, undefined, none.deps)).kind).toBe('enabled')
    expect(none.h.writes()).toHaveLength(0)
    const blocked = await setup({ labels: ['sexual'] })
    const out = await enableApp(blocked.h.server, BSKY, blocked.image, blocked.deps)
    expect(out).toMatchObject({ kind: 'enabled', message: expect.stringContaining(RATING_BLOCKED_MESSAGE) })
    expect((await blocked.store.get(DID, 'bluesky')).enabled).toBe(true)
  })

  it('unticking stops pushes, leaves the record as it is, and forgets the agreement to create', async () => {
    const { h, image, store, deps } = await setupNoProfile()
    await enableApp(h.server, BSKY, image, deps, { create: true })
    const before = h.profile()
    const msg = await disableApp(deps, DID, BSKY)
    expect(msg).toContain('keeps the picture it has')
    expect(await store.get(DID, 'bluesky')).toMatchObject({ enabled: false, mayCreate: false })
    expect(h.profile()).toEqual(before)
    expect(await syncAfterDefaultChange(h.server, image, deps)).toBeNull()
  })

  it('keeps each app\'s choice apart', async () => {
    const store = memoryPushStore()
    await store.setEnabled(DID, 'bluesky', true)
    expect(await store.enabledApps(DID)).toEqual(['bluesky'])
    expect((await store.get(DID, 'tangled')).enabled).toBe(false)
    expect(await store.enabledApps('did:plc:other')).toEqual([])
  })
})

describe('the Tangled entry on a non-Bluesky server', () => {
  it('pushes to its own record, keeps its other fields, and keeps the choices apart per app', async () => {
    const origin = 'https://pds.selfhosted.example'
    const h = mockHomeServer({ did: 'did:web:alice.example', serverUrl: origin, collection: TANGLED.collection, profile: { $type: TANGLED.collection, description: 'builds things', links: ['https://example.com'] } })
    const blob = h.putBlob('src-1', await testJpeg(500, 500))
    const image: StoredImage = { uri: 'at://did:web:alice.example/com.blueyvatar.image/a', cid: 'r', rkey: 'a', value: { image: blob, isDefault: true, createdAt: '2024-01-01T00:00:00.000Z' } }
    const store = memoryPushStore()
    const out = await pushToApp(h.server, TANGLED, image, { store, limit: async () => null })
    expect(out).toMatchObject({ ok: true, changed: true })
    expect(h.profile()!.value).toMatchObject({ description: 'builds things', links: ['https://example.com'] })
    expect([...h.origins]).toEqual([origin])
    expect((await store.log('did:web:alice.example', 'tangled')).map((l) => l.action)).toEqual(['set'])
    expect(await store.log('did:web:alice.example', 'bluesky')).toEqual([])
  })
})
