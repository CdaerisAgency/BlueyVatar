import { describe, expect, it } from 'vitest'
import { pageInterests, pageLinks, profileMetadata, type PublicProfile } from './profile-page'

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
})
