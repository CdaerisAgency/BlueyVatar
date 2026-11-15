import { describe, expect, it, vi } from 'vitest'

vi.mock('./store', () => ({ getPool: () => null }))

import { trackAccountInTap } from './tap'

const env = { TAP_URL: 'http://tap.internal:2480', TAP_ADMIN_PASSWORD: 'pw' }
const none = { query: vi.fn(async () => ({ rows: [] })) }

describe('trackAccountInTap', () => {
  it('posts the DID with Basic admin auth', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }))
    await trackAccountInTap('did:plc:a', { pool: none, fetchFn: fetchFn as never, env })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('http://tap.internal:2480/repos/add')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"dids":["did:plc:a"]}')
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('admin:pw').toString('base64')}`)
  })
  it('skips when the env vars are unset', async () => {
    const fetchFn = vi.fn()
    await trackAccountInTap('did:plc:a', { pool: none, fetchFn: fetchFn as never, env: { TAP_URL: 'http://x' } })
    expect(fetchFn).not.toHaveBeenCalled()
  })
  it('skips when a repos row exists', async () => {
    const fetchFn = vi.fn()
    const pool = { query: vi.fn(async () => ({ rows: [{}] })) }
    await trackAccountInTap('did:plc:a', { pool, fetchFn: fetchFn as never, env })
    expect(fetchFn).not.toHaveBeenCalled()
  })
  it('never throws on a network error or a refusal', async () => {
    await expect(trackAccountInTap('did:plc:a', { pool: none, fetchFn: (async () => { throw new Error('down') }) as never, env })).resolves.toBeUndefined()
    await expect(trackAccountInTap('did:plc:a', { pool: none, fetchFn: (async () => new Response('', { status: 401 })) as never, env })).resolves.toBeUndefined()
  })
})
