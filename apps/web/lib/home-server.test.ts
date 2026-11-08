import { describe, expect, it, vi } from 'vitest'

vi.mock('./repo', () => ({
  repoSession: vi.fn(async (did: string) => {
    if (did === 'bad') throw new Error('gone')
    return { did }
  }),
  pdsUrl: vi.fn(async (s: { did: string }) => (s.did === 'junk' ? 'not a url' : 'https://Morel.us-east.host.bsky.network/')),
}))

import { homeServerFor, homeServerHost, homeServerPhrase, serverLabel } from './home-server'

describe('home server', () => {
  it('adds the host in parentheses when known', () => {
    expect(homeServerPhrase('a.example.com')).toBe("your account's home server (a.example.com)")
    expect(homeServerPhrase(null)).toBe("your account's home server")
    expect(serverLabel('a.example.com')).toBe('a.example.com')
    expect(serverLabel(null)).toBe('my home server')
  })
  it('resolves the host name from the session', async () => {
    expect(await homeServerHost('ok')).toBe('morel.us-east.host.bsky.network')
    expect(await homeServerFor('ok')).toContain('(morel.us-east.host.bsky.network)')
  })
  it('falls back without parentheses', async () => {
    expect(await homeServerHost('bad')).toBeNull()
    expect(await homeServerHost('junk')).toBeNull()
    expect(await homeServerFor('bad')).toBe("your account's home server")
  })
})
