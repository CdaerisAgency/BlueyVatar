import { describe, expect, it, vi } from 'vitest'
import { WARM_HEADER, WARM_SIZES, imagePath } from '@blueyvatar/core'
import { PgIndexWrites } from './pg-writes.js'
import { CacheWarmer, DEFAULT_WARM_CONFIG, warmConfigFromEnv, warmerFromEnv } from './warm.js'

const res = (status = 200, cache = 'MISS') => new Response('x', { status, headers: { 'cf-cache-status': cache } })
type F = typeof globalThis.fetch

describe('warmConfigFromEnv', () => {
  it('defaults, overrides, and drops invalid entries', () => {
    expect(warmConfigFromEnv({})).toEqual(DEFAULT_WARM_CONFIG)
    expect(DEFAULT_WARM_CONFIG.sizes).toEqual([80, 128, 256, 512])
    const c = warmConfigFromEnv({ WARM_SIZES: '64, 99, 128', WARM_FORMATS: 'webp,gif', WARM_CONCURRENCY: '4', WARM_MAX_PER_MINUTE: '10' })
    expect(c).toEqual({ sizes: [64, 128], formats: ['webp'], concurrency: 4, maxPerMinute: 10 })
    expect(warmConfigFromEnv({ WARM_SIZES: 'x' }).sizes).toEqual(DEFAULT_WARM_CONFIG.sizes)
  })
})

describe('CacheWarmer', () => {
  it('requests signed canonical URLs for each size and format with the warm header', async () => {
    const calls: Array<[string, Record<string, string>]> = []
    const fetch = vi.fn(async (u: string | URL | Request, init?: RequestInit) => { calls.push([String(u), init?.headers as Record<string, string>]); return res() })
    const w = new CacheWarmer({ publicUrl: 'https://x.test/', signingSecret: 's', warmSecret: 'w', config: { ...DEFAULT_WARM_CONFIG, formats: ['png', 'webp'] }, fetch: fetch as unknown as F })
    await w.warm('did:plc:a', 'bafya')
    const want = (['png', 'webp'] as const).flatMap((f) => WARM_SIZES.map((s) => `https://x.test${imagePath('s', 'did:plc:a', 'bafya', s, f)}`))
    expect(calls.map((c) => c[0]).sort()).toEqual(want.sort())
    expect(calls.every((c) => c[1][WARM_HEADER] === 'w')).toBe(true)
  })
  it('bounds concurrency, swallows errors, and counts cache statuses', async () => {
    let active = 0, peak = 0
    const fetch = vi.fn(async (u: string | URL | Request) => {
      active++; peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 2))
      active--
      if (String(u).includes('/80.png')) throw new Error('boom')
      return res(200, String(u).includes('/128.png') ? 'HIT' : 'MISS')
    })
    const log = vi.fn()
    const info = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new CacheWarmer({ publicUrl: 'https://x.test', signingSecret: 's', config: { ...DEFAULT_WARM_CONFIG, concurrency: 2 }, fetch: fetch as unknown as F, log }).warm('did:plc:a', 'bafya')
    expect(peak).toBeLessThanOrEqual(2)
    expect(log).toHaveBeenCalledOnce()
    expect(JSON.parse(info.mock.calls[0]![0] as string).cacheStatus).toEqual({ error: 1, hit: 1, miss: 2 })
    info.mockRestore()
  })
  it('drops requests over the per-minute cap and recovers after the window', async () => {
    let t = 0
    const fetch = vi.fn(async () => res())
    const info = vi.spyOn(console, 'log').mockImplementation(() => {})
    const w = new CacheWarmer({ publicUrl: 'https://x.test', signingSecret: 's', config: { ...DEFAULT_WARM_CONFIG, maxPerMinute: 6 }, fetch: fetch as unknown as F, now: () => t })
    await w.warm('did:plc:a', 'bafya') // 4
    await w.warm('did:plc:a', 'bafyb') // 2 of 4
    expect(fetch).toHaveBeenCalledTimes(6)
    t = 61_000
    await w.warm('did:plc:a', 'bafyc')
    expect(fetch).toHaveBeenCalledTimes(10)
    info.mockRestore()
  })
  it('never throws, even when fetch rejects everywhere', async () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetch = vi.fn(async () => { throw new Error('down') })
    await expect(new CacheWarmer({ publicUrl: 'https://x.test', signingSecret: 's', fetch: fetch as unknown as F, log: () => {} }).warm('did:plc:a', 'b')).resolves.toBeUndefined()
    info.mockRestore()
  })
})

describe('warmerFromEnv', () => {
  it('is a no-op when the CDN base URL or signing secret is unset', () => {
    expect(warmerFromEnv({ IMG_SIGNING_SECRET: 's' })).toBeUndefined()
    expect(warmerFromEnv({ PUBLIC_DELIVERY_URL: 'https://x.test' })).toBeUndefined()
    expect(warmerFromEnv({ PUBLIC_DELIVERY_URL: 'https://x.test', IMG_SIGNING_SECRET: 's' })).toBeTypeOf('function')
  })
})

describe('PgIndexWrites.purgeImages warming', () => {
  const pool = {} as never
  const tick = () => new Promise((r) => setTimeout(r, 0))
  it('warms after the purge only when asked, and never fails the purge on warm errors', async () => {
    const order: string[] = []
    const db = new PgIndexWrites(pool, {
      onPurge: async (_d, cids) => void order.push(`purge:${cids.join()}`),
      onWarm: async (_d, cid) => { order.push(`warm:${cid}`); throw new Error('boom') },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await db.purgeImages('did:plc:a', ['c1'])
    await tick()
    expect(order).toEqual(['purge:c1'])
    await expect(db.purgeImages('did:plc:a', ['c1', 'c2'], { warm: true })).resolves.toBeUndefined()
    await tick()
    expect(order).toEqual(['purge:c1', 'purge:c1,c2', 'warm:c1', 'warm:c2'])
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
