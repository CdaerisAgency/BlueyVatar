import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OAuthSession } from '@atproto/oauth-client-node'
import { GALLERY_CAPTION_MAX, GALLERY_MAX } from '@blueyvatar/core'
import { RepoError, listImages } from './repo'
import { addGalleryImage, deleteGalleryImage, listGallery, moveGalleryImage, orderGallery, validateCaption } from './gallery'
import { IMAGE_COLLECTION } from './records'

const PLUS = 'did:plc:plusplusplusplusplusplus'
const FREE = 'did:plc:freefreefreefreefreefree'

function pngBytes(w: number, h: number): Uint8Array {
  const b = new Uint8Array(24)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const v = new DataView(b.buffer)
  v.setUint32(16, w)
  v.setUint32(20, h)
  return b
}
const PNG = pngBytes(100, 100)
const fields = { alt: '', caption: '', rating: 'g', rLabel: '', license: 'personal' }

type Rec = { uri: string; cid: string; value: Record<string, unknown> }

/** In-memory stand-in for the PDS endpoints the gallery code calls. */
function fakePds(did: string) {
  const records = new Map<string, Rec>()
  let n = 0
  const calls: string[] = []
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const put = (rkey: string, value: Record<string, unknown>) => records.set(rkey, { uri: `at://${did}/${IMAGE_COLLECTION}/${rkey}`, cid: `cid${++n}`, value })
  const session = {
    did,
    async fetchHandler(path: string, init?: RequestInit) {
      const nsid = path.split('?')[0]!.replace('/xrpc/', '')
      calls.push(nsid)
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      if (nsid === 'com.atproto.repo.listRecords') return json({ records: [...records.values()] })
      if (nsid === 'com.atproto.repo.uploadBlob') return json({ blob: { $type: 'blob', ref: { $link: `blob${++n}` }, mimeType: 'image/png', size: 24 } })
      if (nsid === 'com.atproto.repo.createRecord') {
        const rkey = `r${++n}`
        put(rkey, body.record)
        return json({ uri: `at://${did}/${IMAGE_COLLECTION}/${rkey}`, cid: `cid${n}` })
      }
      if (nsid === 'com.atproto.repo.deleteRecord') {
        records.delete(body.rkey)
        return json({})
      }
      if (nsid === 'com.atproto.repo.applyWrites') {
        for (const w of body.writes) put(w.rkey, w.value)
        return json({})
      }
      return json({ error: 'Unsupported' }, 400)
    },
  }
  return { session: session as unknown as OAuthSession, records, put, calls }
}

const avatarValue = (extra: Record<string, unknown> = {}) => ({ image: { ref: { $link: 'a' } }, license: 'personal', isDefault: true, createdAt: '2026-01-01T00:00:00Z', ...extra })
const galleryValue = (sort: number | undefined, extra: Record<string, unknown> = {}) => ({
  image: { ref: { $link: `g${sort}` } },
  purpose: 'gallery',
  ...(sort === undefined ? {} : { sort }),
  createdAt: '2026-01-01T00:00:00Z',
  ...extra,
})

beforeEach(() => {
  process.env.PLUS_DIDS = PLUS
})
afterEach(() => {
  delete process.env.PLUS_DIDS
})

describe('caption validation', () => {
  it('allows exactly 140 characters and rejects 141', () => {
    expect(validateCaption('a'.repeat(GALLERY_CAPTION_MAX)).ok).toBe(true)
    const r = validateCaption('a'.repeat(GALLERY_CAPTION_MAX + 1))
    expect(r.ok).toBe(false)
  })
  it('counts graphemes, not UTF-16 units', () => {
    expect(validateCaption('👍🏽'.repeat(GALLERY_CAPTION_MAX)).ok).toBe(true)
  })
  it('trims whitespace', () => {
    expect(validateCaption('  hi  ')).toEqual({ ok: true, value: 'hi' })
  })
})

describe('addGalleryImage', () => {
  it('always writes purpose gallery, never a default, and keeps it out of the avatar list', async () => {
    const pds = fakePds(PLUS)
    pds.put('avatar1', avatarValue())
    await addGalleryImage(pds.session, PNG, 'image/png', { ...fields, caption: 'A caption', rating: 'pg' })
    const created = [...pds.records.values()].find((r) => r.value.purpose === 'gallery')!
    expect(created.value).toMatchObject({ purpose: 'gallery', caption: 'A caption', sort: 0, license: 'personal' })
    expect(created.value.isDefault).toBeUndefined()
    expect(created.value.labels).toMatchObject({ values: [{ val: 'nudity' }] })
    const avatars = await listImages(pds.session)
    expect(avatars.map((a) => a.rkey)).toEqual(['avatar1'])
  })
  it('ignores any attempt to set a purpose or default through the form fields', async () => {
    const pds = fakePds(PLUS)
    await addGalleryImage(pds.session, PNG, 'image/png', { ...fields, purpose: 'avatar', isDefault: true } as never)
    const [rec] = [...pds.records.values()]
    expect(rec!.value.purpose).toBe('gallery')
    expect(rec!.value.isDefault).toBeUndefined()
  })
  it('refuses Free users before any write', async () => {
    const pds = fakePds(FREE)
    await expect(addGalleryImage(pds.session, PNG, 'image/png', fields)).rejects.toThrow(RepoError)
    expect(pds.calls).not.toContain('com.atproto.repo.uploadBlob')
    expect(pds.records.size).toBe(0)
  })
  it('enforces GALLERY_MAX server side and ignores avatar records in the count', async () => {
    const pds = fakePds(PLUS)
    for (let i = 0; i < 20; i++) pds.put(`av${i}`, avatarValue({ isDefault: false }))
    for (let i = 0; i < GALLERY_MAX - 1; i++) pds.put(`g${i}`, galleryValue(i))
    await addGalleryImage(pds.session, PNG, 'image/png', fields)
    expect((await listGallery(pds.session)).length).toBe(GALLERY_MAX)
    const before = pds.records.size
    await expect(addGalleryImage(pds.session, PNG, 'image/png', fields)).rejects.toThrow(/up to 12/)
    expect(pds.records.size).toBe(before)
  })
  it('rejects an over-long caption without writing', async () => {
    const pds = fakePds(PLUS)
    await expect(addGalleryImage(pds.session, PNG, 'image/png', { ...fields, caption: 'x'.repeat(141) })).rejects.toThrow(/140/)
    expect(pds.records.size).toBe(0)
  })
  it('rejects bad images and ratings', async () => {
    const pds = fakePds(PLUS)
    await expect(addGalleryImage(pds.session, pngBytes(40, 40), 'image/png', fields)).rejects.toThrow(/smaller than 80/)
    await expect(addGalleryImage(pds.session, PNG, 'image/png', { ...fields, rating: 'z' })).rejects.toThrow(/rating/)
    expect(pds.records.size).toBe(0)
  })
  it('appends after the highest sort', async () => {
    const pds = fakePds(PLUS)
    pds.put('g1', galleryValue(5))
    await addGalleryImage(pds.session, PNG, 'image/png', fields)
    const sorts = (await listGallery(pds.session)).map((i) => i.value.sort)
    expect(sorts).toEqual([5, 6])
  })
})

describe('deleteGalleryImage', () => {
  it('deletes a gallery record', async () => {
    const pds = fakePds(PLUS)
    pds.put('g1', galleryValue(0))
    await deleteGalleryImage(pds.session, 'g1')
    expect(pds.records.size).toBe(0)
  })
  it('refuses avatar records, unknown keys, bad keys, and Free users', async () => {
    const pds = fakePds(PLUS)
    pds.put('av', avatarValue())
    await expect(deleteGalleryImage(pds.session, 'av')).rejects.toThrow(RepoError)
    await expect(deleteGalleryImage(pds.session, 'missing')).rejects.toThrow(RepoError)
    await expect(deleteGalleryImage(pds.session, '../x')).rejects.toThrow(/Invalid/)
    expect(pds.records.has('av')).toBe(true)
    const free = fakePds(FREE)
    free.put('g1', galleryValue(0))
    await expect(deleteGalleryImage(free.session, 'g1')).rejects.toThrow(/Plus/)
    expect(free.records.has('g1')).toBe(true)
  })
})

describe('moveGalleryImage', () => {
  const order = async (pds: ReturnType<typeof fakePds>) => (await listGallery(pds.session)).map((i) => i.rkey)
  it('swaps neighbors by updating sort, keeping purpose gallery', async () => {
    const pds = fakePds(PLUS)
    pds.put('a', galleryValue(0))
    pds.put('b', galleryValue(1))
    pds.put('c', galleryValue(2))
    await moveGalleryImage(pds.session, 'c', 'up')
    expect(await order(pds)).toEqual(['a', 'c', 'b'])
    await moveGalleryImage(pds.session, 'a', 'down')
    expect(await order(pds)).toEqual(['c', 'a', 'b'])
    for (const r of pds.records.values()) expect(r.value.purpose).toBe('gallery')
  })
  it('renumbers records that have no sort, newest first', async () => {
    const pds = fakePds(PLUS)
    pds.put('old', galleryValue(undefined, { createdAt: '2026-01-01T00:00:00Z' }))
    pds.put('new', galleryValue(undefined, { createdAt: '2026-02-01T00:00:00Z' }))
    expect(await order(pds)).toEqual(['new', 'old'])
    await moveGalleryImage(pds.session, 'old', 'up')
    expect(await order(pds)).toEqual(['old', 'new'])
    expect(pds.records.get('old')!.value.sort).toBe(0)
    expect(pds.records.get('new')!.value.sort).toBe(1)
  })
  it('does nothing at the ends, never touches avatars, and refuses Free users', async () => {
    const pds = fakePds(PLUS)
    pds.put('av', avatarValue())
    pds.put('a', galleryValue(0))
    pds.put('b', galleryValue(1))
    await moveGalleryImage(pds.session, 'a', 'up')
    await moveGalleryImage(pds.session, 'b', 'down')
    expect(pds.calls).not.toContain('com.atproto.repo.applyWrites')
    await expect(moveGalleryImage(pds.session, 'av', 'up')).rejects.toThrow(RepoError)
    const free = fakePds(FREE)
    free.put('a', galleryValue(0))
    free.put('b', galleryValue(1))
    await expect(moveGalleryImage(free.session, 'b', 'up')).rejects.toThrow(/Plus/)
  })
})

describe('orderGallery', () => {
  it('puts sorted images first, then unsorted newest first', () => {
    const mk = (rkey: string, sort: number | undefined, createdAt: string) => ({ uri: '', cid: '', rkey, value: galleryValue(sort, { createdAt }) as never })
    const out = orderGallery([mk('u1', undefined, '2026-01-01T00:00:00Z'), mk('s2', 2, '2026-01-01T00:00:00Z'), mk('u2', undefined, '2026-03-01T00:00:00Z'), mk('s1', 1, '2026-01-01T00:00:00Z')])
    expect(out.map((i) => i.rkey)).toEqual(['s1', 's2', 'u2', 'u1'])
  })
})
