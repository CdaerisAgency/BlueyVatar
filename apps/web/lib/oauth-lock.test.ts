import { beforeEach, describe, expect, it, vi } from 'vitest'

const getLockPool = vi.fn()
vi.mock('./pool', () => ({ getLockPool: () => getLockPool() }))
const warn = vi.fn()
vi.mock('./obs', () => ({ log: { warn: (...a: unknown[]) => warn(...a) } }))

import { oauthRequestLock } from './oauth-lock'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A fake pg.Pool: `max` connections, connect() waits for a free one, session advisory locks per key. */
function fakePool(max: number, opts: { connectFails?: boolean; lockFails?: boolean } = {}) {
  let used = 0
  const waiting: (() => void)[] = []
  const held = new Map<string, Promise<void>>()
  const released: boolean[] = []
  const queries: string[] = []
  const pool = {
    connect: async () => {
      if (opts.connectFails) throw new Error('timeout exceeded when trying to connect')
      while (used >= max) await new Promise<void>((r) => waiting.push(r))
      used++
      const mine: (() => void)[] = []
      return {
        query: async (sql: string, params?: unknown[]) => {
          queries.push(sql)
          const key = String(params?.[0])
          if (sql.includes('pg_advisory_unlock')) {
            mine.pop()?.()
          } else if (sql.includes('pg_advisory_lock')) {
            if (opts.lockFails) throw new Error('canceling statement due to lock timeout')
            while (held.has(key)) await held.get(key)
            held.set(key, new Promise<void>((r) => mine.push(() => (held.delete(key), r()))))
          }
          return { rows: [] }
        },
        release: (destroy?: boolean) => {
          released.push(destroy === true)
          mine.splice(0).forEach((f) => f())
          used--
          waiting.shift()?.()
        },
      }
    },
  }
  return { pool, released, queries, inUse: () => used }
}

describe('oauthRequestLock without a pool', () => {
  beforeEach(() => {
    getLockPool.mockReset().mockReturnValue(null)
    warn.mockReset()
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
    await expect(oauthRequestLock('did:plc:x', () => 42)).resolves.toBe(42)
  })
})

describe('oauthRequestLock with a Postgres pool', () => {
  beforeEach(() => {
    getLockPool.mockReset()
    warn.mockReset()
  })

  it('takes an advisory lock and releases it', async () => {
    const f = fakePool(2)
    getLockPool.mockReturnValue(f.pool)
    await expect(oauthRequestLock('@atproto-oauth-client-did:plc:x', () => 'v')).resolves.toBe('v')
    expect(f.queries.some((q) => q.includes('lock_timeout'))).toBe(true)
    expect(f.queries.filter((q) => q.includes('pg_advisory_lock'))).toHaveLength(1)
    expect(f.queries.filter((q) => q.includes('pg_advisory_unlock'))).toHaveLength(1)
    expect(f.released).toEqual([false])
    expect(f.inUse()).toBe(0)
  })

  it('serializes concurrent calls for the same key across the pool', async () => {
    const f = fakePool(4)
    getLockPool.mockReturnValue(f.pool)
    const marks: string[] = []
    const run = (n: string) =>
      oauthRequestLock('k', async () => {
        marks.push(`s${n}`)
        await sleep(30)
        marks.push(`e${n}`)
      })
    await Promise.all([run('1'), run('2')])
    expect(marks).toEqual(['s1', 'e1', 's2', 'e2'])
  })

  it('does not deadlock when the lock pool has one connection and fn needs the main pool', async () => {
    const lock = fakePool(1)
    const main = fakePool(1)
    getLockPool.mockReturnValue(lock.pool)
    const store = async () => {
      const c = await main.pool.connect()
      await sleep(5)
      c.release()
      return 'got'
    }
    const results = await Promise.race([
      Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((n) => oauthRequestLock(n, store))),
      sleep(2000).then(() => 'hung' as const),
    ])
    expect(results).toEqual(['got', 'got', 'got', 'got', 'got', 'got'])
    expect(lock.inUse()).toBe(0)
    expect(main.inUse()).toBe(0)
  })

  it('runs fn without the lock and logs when the lock pool cannot connect', async () => {
    getLockPool.mockReturnValue(fakePool(1, { connectFails: true }).pool)
    await expect(oauthRequestLock('did:plc:x', () => 'ran')).resolves.toBe('ran')
    expect(warn).toHaveBeenCalledWith('oauth lock unavailable', expect.objectContaining({ reason: 'connect' }))
  })

  it('runs fn without the lock, drops the connection and logs when lock_timeout fires', async () => {
    const f = fakePool(1, { lockFails: true })
    getLockPool.mockReturnValue(f.pool)
    await expect(oauthRequestLock('did:plc:x', () => 'ran')).resolves.toBe('ran')
    expect(warn).toHaveBeenCalledWith('oauth lock unavailable', expect.objectContaining({ reason: 'lock' }))
    expect(f.released).toEqual([true])
    expect(f.inUse()).toBe(0)
  })

  it('releases the lock and the client when fn throws', async () => {
    const f = fakePool(1)
    getLockPool.mockReturnValue(f.pool)
    await expect(
      oauthRequestLock('k', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(f.queries.filter((q) => q.includes('pg_advisory_unlock'))).toHaveLength(1)
    expect(f.released).toEqual([false])
    expect(f.inUse()).toBe(0)
    await expect(oauthRequestLock('k', () => 'again')).resolves.toBe('again')
  })
})
