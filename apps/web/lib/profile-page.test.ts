import { describe, expect, it } from 'vitest'
import { GALLERY_MAX } from '@blueyvatar/core'
import { pageAtprotoApps, pageGallery, pageInterests, pageLinks, profileMetadata, type PublicProfile } from './profile-page'

const base: PublicProfile = { did: 'did:plc:a', handle: 'alice.test', displayName: 'Alice', description: 'Hi there', avatar: { url: '/img/x/y/256.png' }, jobTitle: null, company: null, location: null, pronouns: null }

describe('profile page model', () => {
  it('builds Open Graph and Twitter metadata with the avatar on the public delivery origin', () => {
    const m = profileMetadata(base, 'alice.test', 'https://img.example/')
    expect(m.title).toBe('Alice')
    expect(m.openGraph.images).toEqual(['https://img.example/img/x/y/256.png'])
    expect(m.twitter.images).toEqual(m.openGraph.images)
    expect(m.twitter.description).toBe('Hi there')
  })
  it('falls back when there is no description or avatar', () => {
    const m = profileMetadata({ ...base, displayName: null, description: null, avatar: null, jobTitle: 'Dev', company: 'Acme', location: 'Oslo' }, 'alice.test', 'https://i.test')
    expect(m.title).toBe('alice.test')
    expect(m.description).toBe('Dev, Acme | Oslo')
    expect(m.openGraph.images).toEqual([])
  })
  it('re-checks links and interests', () => {
    expect(pageLinks({ ...base, links: [{ label: 'A', url: 'https://a.test/' }, { label: 'B', url: 'javascript:1' }] })).toEqual([{ label: 'A', url: 'https://a.test/' }])
    expect(pageInterests({ ...base, interests: ['go', '', 3, 'tea'] })).toEqual(['go', 'tea'])
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
