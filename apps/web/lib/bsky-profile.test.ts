import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { currentBlueskyAvatar, restoreBlueskyAvatar, setBlueskyAvatar } from './bsky-profile'
import { mockHomeServer, testJpeg } from './bsky-test-server'

const tooLarge = vi.hoisted(() => ({ on: false }))
vi.mock('./bsky-avatar-image', async (orig) => {
  const real = await orig<typeof import('./bsky-avatar-image')>()
  return { ...real, prepareBlueskyAvatar: (...a: Parameters<typeof real.prepareBlueskyAvatar>) => (tooLarge.on ? Promise.resolve({ ok: false as const, error: real.BSKY_AVATAR_TOO_LARGE }) : real.prepareBlueskyAvatar(...a)) }
})

const OLD = { $type: 'blob' as const, ref: { $link: 'old-avatar' }, mimeType: 'image/jpeg', size: 10 }
const FULL = {
  $type: 'app.bsky.actor.profile',
  displayName: 'Alice',
  description: 'hi',
  avatar: OLD,
  banner: { $type: 'blob', ref: { $link: 'banner' }, mimeType: 'image/png', size: 5 },
  labels: { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'nudity' }] },
  pinnedPost: { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' },
  joinedViaStarterPack: { uri: 'at://x/app.bsky.graph.starterpack/1', cid: 'c' },
  createdAt: '2024-01-01T00:00:00.000Z',
  someFutureField: { nested: [1, 2, 3] },
}

describe('setBlueskyAvatar', () => {
  it('changes only the avatar and keeps every other field, known or not, and the record type', async () => {
    const h = mockHomeServer({ profile: FULL })
    const r = await setBlueskyAvatar(h.server, { bytes: await testJpeg(640, 480) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.previous).toEqual(OLD)
    const { avatar, ...rest } = h.profile()!.value as Record<string, unknown>
    const { avatar: _old, ...before } = FULL
    expect(rest).toEqual(before)
    expect((avatar as { ref: { $link: string } }).ref.$link).toBe(r.avatar!.ref.$link)
    expect(h.writes()).toHaveLength(1)
    expect((h.writes()[0]!.body as { swapRecord: string }).swapRecord).toBe('cid-v1')
  })

  it('uploads a square PNG or JPEG under 1,000,000 bytes sized from the source', async () => {
    const h = mockHomeServer({ profile: FULL })
    await setBlueskyAvatar(h.server, { bytes: await testJpeg(1200, 800) })
    const sent = [...h.blobs.values()][0]!
    const meta = await sharp(Buffer.from(sent.bytes)).metadata()
    expect(['image/png', 'image/jpeg']).toContain(sent.mime)
    expect(meta.width).toBe(meta.height)
    expect(meta.width).toBe(800)
    expect(sent.bytes.byteLength).toBeLessThanOrEqual(1_000_000)
  })

  it('follows the crop chosen for the image', async () => {
    const h = mockHomeServer({ profile: FULL })
    // 100x100 source of the left half red, right half blue; crop the right half (x 5000, size 5000 of the short side).
    const src = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#ff0000' } })
      .composite([{ input: await sharp({ create: { width: 100, height: 100, channels: 3, background: '#0000ff' } }).png().toBuffer(), left: 100, top: 0 }])
      .png()
      .toBuffer()
    await setBlueskyAvatar(h.server, { bytes: new Uint8Array(src), crop: { x: 5000, y: 0, size: 10000 } })
    const px = await sharp(Buffer.from([...h.blobs.values()][0]!.bytes)).raw().toBuffer({ resolveWithObject: true })
    expect([px.data[0], px.data[2]]).toEqual([0, 255])
  })

  it('reports a version conflict and writes nothing', async () => {
    const h = mockHomeServer({ profile: FULL })
    const orig = h.server.fetchHandler.bind(h.server)
    // The profile changes on Bluesky between our read and our write.
    h.server.fetchHandler = async (p, init) => {
      if (p.includes('uploadBlob')) h.editElsewhere({ displayName: 'Alice B' })
      return orig(p, init)
    }
    const r = await setBlueskyAvatar(h.server, { bytes: await testJpeg(300, 300) })
    expect(r).toMatchObject({ ok: false, code: 'conflict' })
    expect(h.profile()!.value).toMatchObject({ displayName: 'Alice B', avatar: OLD })
    expect(h.profile()!.cid).toBe('cid-v2')
  })

  it('reports a missing permission from the home server', async () => {
    const h = mockHomeServer({ profile: FULL, failWith: { 'com.atproto.repo.putRecord': 403 } })
    const r = await setBlueskyAvatar(h.server, { bytes: await testJpeg(300, 300) })
    expect(r).toMatchObject({ ok: false, code: 'no_permission', message: expect.stringContaining('Sign in again to allow this') })
  })

  it('reports an image that is still too large after shrinking, and writes nothing', async () => {
    tooLarge.on = true
    try {
      const h = mockHomeServer({ profile: FULL })
      const r = await setBlueskyAvatar(h.server, { bytes: await testJpeg(300, 300) })
      expect(r).toMatchObject({ ok: false, code: 'too_large' })
      expect(h.writes()).toHaveLength(0)
      expect(h.calls.some((c) => c.nsid === 'com.atproto.repo.uploadBlob')).toBe(false)
    } finally {
      tooLarge.on = false
    }
  })

  it('says so when there is no profile record yet, without creating one', async () => {
    const h = mockHomeServer({ profile: null })
    const r = await setBlueskyAvatar(h.server, { bytes: await testJpeg(300, 300) })
    expect(r).toMatchObject({ ok: false, code: 'no_profile' })
    expect(h.writes()).toHaveLength(0)
  })

  it('reports home server errors in plain words', async () => {
    const down = mockHomeServer({ profile: FULL, failWith: { 'com.atproto.repo.uploadBlob': 500 } })
    expect(await setBlueskyAvatar(down.server, { bytes: await testJpeg(300, 300) })).toMatchObject({ ok: false, code: 'home_server', message: expect.stringContaining("home server") })
    const gone = mockHomeServer({ profile: FULL })
    gone.server.fetchHandler = async () => {
      throw new TypeError('fetch failed')
    }
    expect(await setBlueskyAvatar(gone.server, { bytes: await testJpeg(300, 300) })).toMatchObject({ ok: false, code: 'home_server' })
  })

  it('rejects bytes that are not an image', async () => {
    const h = mockHomeServer({ profile: FULL })
    expect(await setBlueskyAvatar(h.server, { bytes: new TextEncoder().encode('not an image') })).toMatchObject({ ok: false, code: 'bad_image' })
    expect(h.writes()).toHaveLength(0)
  })
})

describe('restoreBlueskyAvatar', () => {
  it('puts the previous blob back and keeps the other fields', async () => {
    const h = mockHomeServer({ profile: FULL })
    h.putBlob('old-avatar', await testJpeg(100, 100))
    const set = await setBlueskyAvatar(h.server, { bytes: await testJpeg(300, 300) })
    expect(set.ok).toBe(true)
    const r = await restoreBlueskyAvatar(h.server, OLD)
    expect(r.ok).toBe(true)
    expect(h.profile()!.value).toEqual(FULL)
  })

  it('removes the avatar when the profile had none before', async () => {
    const { avatar: _a, ...noAvatar } = FULL
    const h = mockHomeServer({ profile: noAvatar })
    await setBlueskyAvatar(h.server, { bytes: await testJpeg(300, 300) })
    const r = await restoreBlueskyAvatar(h.server, null)
    expect(r.ok).toBe(true)
    expect(h.profile()!.value).toEqual(noAvatar)
  })

  it('says so when the previous picture is no longer stored', async () => {
    const h = mockHomeServer({ profile: FULL })
    expect(await restoreBlueskyAvatar(h.server, OLD)).toMatchObject({ ok: false, code: 'blob_gone' })
  })

  it('does not overwrite a profile that changed since', async () => {
    const h = mockHomeServer({ profile: FULL })
    h.putBlob('old-avatar', await testJpeg(100, 100))
    const orig = h.server.fetchHandler.bind(h.server)
    h.server.fetchHandler = async (p, init) => {
      if (p.includes('putRecord')) h.editElsewhere({ description: 'changed' })
      return orig(p, init)
    }
    expect(await restoreBlueskyAvatar(h.server, OLD)).toMatchObject({ ok: false, code: 'conflict' })
    expect(h.profile()!.value).toMatchObject({ description: 'changed' })
  })
})

describe('currentBlueskyAvatar', () => {
  it('reads the avatar blob, or null when none', async () => {
    expect(await currentBlueskyAvatar(mockHomeServer({ profile: FULL }).server)).toMatchObject({ ok: true, avatar: OLD })
    expect(await currentBlueskyAvatar(mockHomeServer({ profile: { $type: 'app.bsky.actor.profile' } }).server)).toEqual({ ok: true, avatar: null })
  })
})
