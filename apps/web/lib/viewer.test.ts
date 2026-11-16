import { beforeEach, describe, expect, it, vi } from 'vitest'

const repoSession = vi.fn()
const repoHandle = vi.fn()
const query = vi.fn()
vi.mock('./auth', () => ({ currentDid: async () => null }))
vi.mock('./repo', () => ({ repoSession: (d: string) => repoSession(d) }))
vi.mock('./claims-repo', () => ({ repoHandle: (s: unknown) => repoHandle(s) }))
vi.mock('./pool', () => ({ getPool: () => ({ query }) }))

import { resolveHandle } from './viewer'

let n = 0
const newDid = () => `did:plc:test${++n}`

beforeEach(() => {
  vi.clearAllMocks()
  repoSession.mockResolvedValue({})
})

describe('resolveHandle', () => {
  it('uses the OAuth path first', async () => {
    repoHandle.mockResolvedValue('ann.bsky.social')
    expect(await resolveHandle(newDid())).toBe('ann.bsky.social')
    expect(query).not.toHaveBeenCalled()
  })

  it('falls back to repos.handle when there is no OAuth session', async () => {
    repoSession.mockRejectedValue(new Error('gone'))
    query.mockResolvedValue({ rows: [{ handle: 'ann.example.com' }] })
    const did = newDid()
    expect(await resolveHandle(did)).toBe('ann.example.com')
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM repos'), [did])
  })

  it('falls back when the OAuth path returns no handle', async () => {
    repoHandle.mockResolvedValue(null)
    query.mockResolvedValue({ rows: [{ handle: 'ann.example.com' }] })
    expect(await resolveHandle(newDid())).toBe('ann.example.com')
  })

  it('never trusts handle.invalid, or a missing row, or a failing query', async () => {
    repoSession.mockRejectedValue(new Error('gone'))
    query.mockResolvedValueOnce({ rows: [{ handle: 'handle.invalid' }] })
    expect(await resolveHandle(newDid())).toBeNull()
    query.mockResolvedValueOnce({ rows: [] })
    expect(await resolveHandle(newDid())).toBeNull()
    query.mockRejectedValueOnce(new Error('db down'))
    expect(await resolveHandle(newDid())).toBeNull()
  })

  it('caches a hit and a miss', async () => {
    repoSession.mockRejectedValue(new Error('gone'))
    query.mockResolvedValue({ rows: [{ handle: 'ann.example.com' }] })
    const hit = newDid()
    await resolveHandle(hit)
    await resolveHandle(hit)
    expect(query).toHaveBeenCalledTimes(1)
    query.mockResolvedValue({ rows: [] })
    const miss = newDid()
    await resolveHandle(miss)
    await resolveHandle(miss)
    expect(query).toHaveBeenCalledTimes(2)
  })
})
