import { describe, expect, it, vi } from 'vitest'
import { bskyAvatarBlob, fetchRemoteImage, gravatarUrl, isAllowedImportUrl, libravatarUrl, parseImportSource, readCapped, suggestedRating } from './import'
import { parseSourceParam } from './import-load'
import { MAX_BLOB_BYTES } from './upload-limits'

const H = 'a'.repeat(64)
const PNG = (() => {
  const b = new Uint8Array(24)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const v = new DataView(b.buffer)
  v.setUint32(16, 100)
  v.setUint32(20, 100)
  return b
})()
const res = (body: Uint8Array | string, init: ResponseInit = {}) => new Response(body as BodyInit, init)

describe('import urls', () => {
  it('builds documented Gravatar and Libravatar urls with d=404', () => {
    expect(gravatarUrl(H)).toBe(`https://gravatar.com/avatar/${H}?s=1024&d=404&r=x`)
    expect(libravatarUrl(H)).toBe(`https://seccdn.libravatar.org/avatar/${H}?s=512&d=404`)
  })
  it('rejects anything but a SHA256 hash', () => {
    expect(() => gravatarUrl('https://evil.example')).toThrow()
    expect(() => libravatarUrl('abc')).toThrow()
  })
  it('allows only fixed https hosts', () => {
    expect(isAllowedImportUrl(gravatarUrl(H))).toBe(true)
    expect(isAllowedImportUrl('https://seccdn.libravatar.org/x')).toBe(true)
    expect(isAllowedImportUrl('http://gravatar.com/x')).toBe(false)
    expect(isAllowedImportUrl('https://gravatar.com.evil.example/x')).toBe(false)
    expect(isAllowedImportUrl('https://evilgravatar.com/x')).toBe(false)
    expect(isAllowedImportUrl('https://user@gravatar.com/x')).toBe(false)
    expect(isAllowedImportUrl('https://169.254.169.254/')).toBe(false)
    expect(isAllowedImportUrl('nope')).toBe(false)
  })
})

describe('source params and ratings', () => {
  it('parses sources', () => {
    expect(parseImportSource('gravatar')).toBe('gravatar')
    expect(parseImportSource('x')).toBeNull()
    expect(parseSourceParam('bluesky')).toEqual({ source: 'bluesky' })
    expect(parseSourceParam(`gravatar:${H}`)).toEqual({ source: 'gravatar', hash: H })
    expect(parseSourceParam('gravatar:http://evil')).toBeNull()
    expect(parseSourceParam('gravatar')).toBeNull()
    expect(parseSourceParam(`bluesky:${H}`)).toBeNull()
  })
  it('defaults Bluesky to G only without labels', () => {
    expect(suggestedRating('bluesky', undefined)).toBe('g')
    expect(suggestedRating('bluesky', { values: [{ val: 'porn' }] })).toBe('x')
    expect(suggestedRating('gravatar', undefined)).toBeNull()
    expect(suggestedRating('libravatar', undefined)).toBeNull()
  })
})

describe('bskyAvatarBlob', () => {
  const rec = (a: object) => ({ avatar: { $type: 'blob', ref: { $link: 'bafkreiabcdefghijk' }, ...a } })
  it('accepts PNG and JPEG under the limit', () => {
    expect(bskyAvatarBlob(rec({ mimeType: 'image/jpeg', size: 5000 }))).toEqual({ ok: true, value: { cid: 'bafkreiabcdefghijk', mimeType: 'image/jpeg', size: 5000 } })
  })
  it('explains each rejection', () => {
    expect(bskyAvatarBlob({})).toMatchObject({ ok: false, error: expect.stringContaining('no avatar') })
    expect(bskyAvatarBlob(rec({ mimeType: 'image/webp', size: 5 }))).toMatchObject({ ok: false, error: expect.stringContaining('PNG and JPEG') })
    expect(bskyAvatarBlob(rec({ mimeType: 'image/png', size: MAX_BLOB_BYTES + 1 }))).toMatchObject({ ok: false, error: expect.stringContaining('5,242,880') })
    expect(bskyAvatarBlob(rec({ mimeType: 'image/png', size: MAX_BLOB_BYTES }))).toMatchObject({ ok: true })
  })
})

describe('capped fetch', () => {
  it('reads a body under the cap and rejects one over it', async () => {
    expect((await readCapped(res(new Uint8Array(10)), 10))?.length).toBe(10)
    expect(await readCapped(res(new Uint8Array(11)), 10)).toBeNull()
  })
  it('returns a valid image', async () => {
    const f = vi.fn(async () => res(PNG))
    const r = await fetchRemoteImage(gravatarUrl(H), 'Gravatar', f as unknown as typeof fetch)
    expect(r).toMatchObject({ ok: true, value: { mime: 'image/png' } })
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('manual')
  })
  it('reports a missing image on 404', async () => {
    const r = await fetchRemoteImage(gravatarUrl(H), 'Gravatar', (async () => res('', { status: 404 })) as typeof fetch)
    expect(r).toEqual({ ok: false, error: 'Gravatar has no image for this email.' })
  })
  it('rejects non-image bytes and oversize bodies', async () => {
    expect(await fetchRemoteImage(libravatarUrl(H), 'Libravatar', (async () => res(new TextEncoder().encode('GIF89a..'))) as typeof fetch)).toMatchObject({ ok: false, error: expect.stringContaining('PNG and JPEG') })
    const big = await fetchRemoteImage(libravatarUrl(H), 'Libravatar', (async () => res(new Uint8Array(MAX_BLOB_BYTES + 1))) as typeof fetch)
    expect(big).toMatchObject({ ok: false, error: expect.stringContaining('5,242,880') })
  })
  it('follows redirects only to allowed hosts', async () => {
    const ok = vi.fn()
      .mockResolvedValueOnce(res('', { status: 302, headers: { location: 'https://secure.gravatar.com/avatar/x' } }))
      .mockResolvedValueOnce(res(PNG))
    expect((await fetchRemoteImage(gravatarUrl(H), 'Gravatar', ok as unknown as typeof fetch)).ok).toBe(true)
    const bad = vi.fn().mockResolvedValueOnce(res('', { status: 302, headers: { location: 'http://127.0.0.1/secret' } }))
    expect((await fetchRemoteImage(gravatarUrl(H), 'Gravatar', bad as unknown as typeof fetch)).ok).toBe(false)
    expect(bad).toHaveBeenCalledTimes(1)
  })
  it('turns a timeout or network error into a message', async () => {
    const r = await fetchRemoteImage(gravatarUrl(H), 'Gravatar', (async () => { throw new Error('x') }) as typeof fetch)
    expect(r.ok).toBe(false)
  })
})
