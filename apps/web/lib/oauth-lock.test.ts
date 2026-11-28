import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPool = vi.fn()
vi.mock('./pool', () => ({ getPool: () => getPool() }))
const inTx = vi.fn()
vi.mock('./tx', () => ({ inTx: (...a: unknown[]) => inTx(...a) }))

import { oauthRequestLock } from './oauth-lock'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('oauthRequestLock', () => {
  beforeEach(() => {
    getPool.mockReset().mockReturnValue(null)
    inTx.mockReset()
  })

  it('serializes concurrent calls for the same key', async () => {
    const marks: string[] = []
    const run = (n: string) =>
      oauthRequestLock('did:plc:x', async () => {
        marks.push(`s${n}`)
        await sleep(50)
        marks.push(`e${n}`)
      })
    await Promise.all([run('1'), run('2')])
    expect(marks).toEqual(['s1', 'e1', 's2', 'e2'])
  })

  it('runs different keys in parallel', async () => {
    const marks: string[] = []
    const run = (name: string) =>
      oauthRequestLock(name, async () => {
        marks.push(`s${name}`)
        await sleep(50)
        marks.push(`e${name}`)
      })
    await Promise.all([run('a'), run('b')])
    expect(marks.slice(0, 2).sort()).toEqual(['sa', 'sb'])
  })

  it('keeps the chain going after a failed call', async () => {
    const first = oauthRequestLock('k', async () => {
      throw new Error('boom')
    })
    const second = oauthRequestLock('k', () => 'ok')
    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toBe('ok')
  })

  it('falls back to in-process lock without a pool', async () => {
    getPool.mockReturnValue(null)
    await expect(oauthRequestLock('did:plc:x', () => 42)).resolves.toBe(42)
    expect(inTx).not.toHaveBeenCalled()
  })

  it('uses a Postgres advisory lock when a pool exists', async () => {
    const pool = {}
    getPool.mockReturnValue(pool)
    inTx.mockImplementation(async (_pool: unknown, fn: () => Promise<unknown>) => fn())
    await expect(oauthRequestLock('did:plc:x', () => 'v')).resolves.toBe('v')
    expect(inTx).toHaveBeenCalledTimes(1)
    expect(inTx.mock.calls[0]![0]).toBe(pool)
    expect(inTx.mock.calls[0]![2]).toEqual({ lock: 'oauth-refresh:did:plc:x' })
  })
})
