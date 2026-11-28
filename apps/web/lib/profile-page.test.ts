import { describe, expect, it } from 'vitest'
import { GALLERY_MAX } from '@blueyvatar/core'
import { AVATAR_SIZES, avatarWebpSrcSet, pageAtprotoApps, pageColors, pageGallery, pageInterests, pageLinks, profileMetadata, type PublicProfile } from './profile-page'

const base: PublicProfile = { did: 'did:plc:a', handle: 'alice.test', displayName: 'Alice', description: 'Hi there', avatar: { url: '/img/x/y/256.png' }, jobTitle: null, company: null, location: null, pronouns: null }

describe('profile page model', () => {
  it('builds Open Graph and Twitter metadata with the avatar on the public delivery origin', () => {
    const m = profileMetadata(base, 'alice.test', 'https://img.example/')
    expect(m.title).toBe('Alice')
    expect(m.openGraph.title).toBe('Alice')
    expect(m.openGraph.images).toEqual(['https://img.example/img/x/y/256.png'])
    expect(m.twitter.images).toEqual(m.openGraph.images)
    expect(m.twitter.description).toBe('Hi there')
  })
  it('falls back to the default image and text when there is no description or avatar', () => {
    const m = profileMetadata({ ...base, displayName: null, description: null, avatar: null, jobTitle: 'Dev', company: 'Acme', location: 'Oslo' }, 'alice.test', 'https://i.test')
    expect(m.title).toBe('alice.test')
    expect(m.description).toBe('Dev, Acme | Oslo')
    expect(m.openGraph.images).toEqual(['https://blueyvatar.com/logo.jpg'])
  })
  it('always has a non-empty title, even when the display name or handle is blank', () => {
    const t = (over: Partial<PublicProfile>, handle = 'url.test') => profileMetadata({ ...base, ...over }, handle, 'https://i.test').title
    expect(t({ displayName: '' })).toBe('alice.test')
    expect(t({ displayName: '   ' })).toBe('alice.test')
    expect(t({ displayName: '', handle: '' })).toBe('url.test')
    expect(t({ displayName: null, handle: null })).toBe('url.test')
    expect(t({ displayName: null, handle: null }, '')).toBe('Profile')
  })
  it('re-checks links and interests', () => {
    expect(pageLinks({ ...base, links: [{ label: 'A', url: 'https://a.test/' }, { label: 'B', url: 'javascript:1' }] })).toEqual([{ label: 'A', url: 'https://a.test/' }])
    expect(pageInterests({ ...base, interests: ['go', '', 3, 'tea'] })).toEqual(['go', 'tea'])
  })
  describe('background color', () => {
    it('uses the default palette when no color is set', () => {
      expect(pageColors(base)).toBeNull()
      expect(pageColors({ ...base, backgroundColor: null })).toBeNull()
    })
    it('picks white text on dark colors and dark text on light colors', () => {
      expect(pageColors({ ...base, backgroundColor: '#1f4e9b' })).toEqual({ background: '#1f4e9b', text: '#ffffff' })
      expect(pageColors({ ...base, backgroundColor: '#FFF1C9' })).toEqual({ background: '#fff1c9', text: '#1a1a1a' })
    })
    it('falls back to the default palette for malformed colors and for colors where no text passes 4.5 to 1', () => {
      expect(pageColors({ ...base, backgroundColor: 'red; background:url(//evil)' })).toBeNull()
      expect(pageColors({ ...base, backgroundColor: '#777777' })).toBeNull()
    })
  })
  it('keeps only well-formed atproto apps, once each', () => {
    const a = { name: 'Tangled', url: 'https://tangled.org' }
    expect(pageAtprotoApps({ ...base, atprotoApps: [a, a, { name: 'X', url: 'http://x.test' }, { name: 3, url: 'https://y.test' }, null] })).toEqual(['Tangled'])
    expect(pageAtprotoApps(base)).toEqual([])
    expect(pageAtprotoApps({ ...base, atprotoApps: 'nope' })).toEqual([])
  })
  describe('gallery', () => {
    const g = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `/img/d/c${i}/sig/512.png`, caption: i === 0 ? 'First' : '' }))
    it('renders nothing for Free users even when the JSON carries a gallery', () => {
      expect(pageGallery({ ...base, gallery: g(2) }, false)).toEqual([])
    })
    it('renders signed /img paths for Plus users and drops anything else', () => {
      const out = pageGallery({ ...base, gallery: [...g(1), { url: 'https://pds.example/blob/x' }, { url: 3 }, null, 'x'] }, true)
      expect(out).toEqual([{ url: '/img/d/c0/sig/512.png', caption: 'First' }])
    })
    it('caps the gallery', () => {
      expect(pageGallery({ ...base, gallery: g(30) }, true)).toHaveLength(GALLERY_MAX)
    })
    it('tolerates a missing or malformed gallery', () => {
      expect(pageGallery(base, true)).toEqual([])
      expect(pageGallery({ ...base, gallery: 'nope' }, true)).toEqual([])
    })
  })
})

describe('avatarWebpSrcSet', () => {
  const withVariants = (variants: unknown): PublicProfile => ({ ...base, avatar: { url: '/img/x/y/s/256.png', variants } })
  it('lists only the WebP variants, on the delivery origin', () => {
    const p = withVariants([
      { size: 256, format: 'webp', url: '/img/x/y/s/256-q85.webp' },
      { size: 512, format: 'webp', url: '/img/x/y/s/512-q85.webp' },
      { size: 512, format: 'png', url: '/img/x/y/s/512.png' },
    ])
    expect(avatarWebpSrcSet(p, 'https://img.example/')).toBe('https://img.example/img/x/y/s/256-q85.webp 256w, https://img.example/img/x/y/s/512-q85.webp 512w')
  })
  it('is null for an older delivery service, no avatar, or unsafe entries', () => {
    expect(avatarWebpSrcSet(base, 'https://img.example')).toBeNull()
    expect(avatarWebpSrcSet({ ...base, avatar: null }, 'https://img.example')).toBeNull()
    expect(avatarWebpSrcSet(withVariants([{ size: 256, format: 'webp', url: 'https://evil.test/a.webp' }, null, { size: '256', format: 'webp', url: '/img/a.webp' }]), 'https://img.example')).toBeNull()
  })
  it('sizes match the 258 px picture box', () => {
    expect(AVATAR_SIZES).toContain('258px')
  })
})
