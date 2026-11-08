import { describe, expect, it, vi } from 'vitest'

const cur = vi.fn()
vi.mock('./viewer', () => ({ currentViewer: () => cur() }))

import { GET } from '../app/api/viewer/route'
import { viewerPayload } from './viewer-core'

describe('GET /api/viewer', () => {
  it('returns signed out, uncached', async () => {
    cur.mockResolvedValue(null)
    const res = await GET()
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ signedIn: false })
  })
  it('returns the handle and initial when signed in', async () => {
    cur.mockResolvedValue({ did: 'did:plc:x', handle: 'ann.bsky.social' })
    expect(await (await GET()).json()).toEqual({ signedIn: true, name: 'ann.bsky.social', initial: 'A' })
  })
  it('falls back to the DID and treats a lookup failure as signed out', async () => {
    expect(viewerPayload({ did: 'did:plc:x', handle: null })).toEqual({ signedIn: true, name: 'did:plc:x', initial: '?' })
    cur.mockRejectedValue(new Error('x'))
    expect(await (await GET()).json()).toEqual({ signedIn: false })
  })
})
