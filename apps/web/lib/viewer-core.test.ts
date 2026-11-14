import { describe, expect, it } from 'vitest'
import { avatarInitial, avatarSrcFor, viewerPayload, displayName, makeTtlCache } from './viewer-core'

describe('viewer-core', () => {
  it('shows the handle, else the DID', () => {
    expect(displayName({ did: 'did:plc:abc', handle: 'a.bsky.social' })).toBe('a.bsky.social')
    expect(displayName({ did: 'did:plc:abc', handle: null })).toBe('did:plc:abc')
  })
  it('builds the avatar initial', () => {
    expect(avatarInitial({ did: 'd', handle: 'blue.bsky.social' })).toBe('B')
    expect(avatarInitial({ did: 'd', handle: null })).toBe('?')
  })
  it('builds the menu avatar URL, or none without a delivery base', () => {
    expect(avatarSrcFor('did:plc:abc', 'https://img.example.com/')).toBe('https://img.example.com/u/did%3Aplc%3Aabc?s=88&d=404')
    expect(avatarSrcFor('did:plc:abc', null)).toBeNull()
    expect(viewerPayload({ did: 'did:plc:abc', handle: null }, 'https://img.example.com')).toMatchObject({ signedIn: true, initial: '?', avatarSrc: expect.stringContaining('/u/did%3Aplc%3Aabc') })
  })
  it('expires cache entries', () => {
    let t = 0
    const c = makeTtlCache<string>(10, 2, () => t)
    c.set('a', 'x')
    expect(c.get('a')).toBe('x')
    t = 11
    expect(c.get('a')).toBeUndefined()
  })
})
