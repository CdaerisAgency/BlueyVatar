import { describe, expect, it, vi } from 'vitest'
import { imagePath } from '@blueyvatar/core'
import { CloudflarePurger } from './cloudflare.js'
import { warmImage } from './warm.js'

const ok = () => new Response('{}', { status: 200 })

describe('CloudflarePurger', () => {
  it('purges the size ladder by URL in batches of at most 100', async () => {
    const fetch = vi.fn(async () => ok())
    const p = new CloudflarePurger({ zoneId: 'z', apiToken: 't', publicUrl: 'https://blueyvatar.com/', signingSecret: 's', fetch })
    await p.purge('did:plc:a', ['bafya', 'bafyb', 'bafyc'])
    const bodies = fetch.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string).files as string[])
    expect(bodies.map((b) => b.length)).toEqual([100, 35])
    expect(bodies[0]![0]).toBe(`https://blueyvatar.com${imagePath('s', 'did:plc:a', 'bafya', 16, 'png')}`)
    expect(fetch.mock.calls[0]![0]).toBe('https://api.cloudflare.com/client/v4/zones/z/purge_cache')
  })
  it('supports prefix mode', async () => {
    const fetch = vi.fn(async () => ok())
    await new CloudflarePurger({ zoneId: 'z', apiToken: 't', publicUrl: 'https://blueyvatar.com', mode: 'prefix', fetch }).purge('did:plc:a', ['bafya'])
    expect(JSON.parse((fetch.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ prefixes: ['blueyvatar.com/img/did%3Aplc%3Aa/bafya/'] })
  })
  it('retries, then logs and gives up without throwing', async () => {
    const fetch = vi.fn(async () => new Response('no', { status: 500 }))
    const log = { info: vi.fn(), error: vi.fn() }
    await new CloudflarePurger({ zoneId: 'z', apiToken: 't', publicUrl: 'https://x.test', signingSecret: 's', retries: 3, retryDelayMs: 1, fetch, log }).purge('did:plc:a', ['bafya'])
    expect(fetch).toHaveBeenCalledTimes(3) // 45 URLs fit one request
    expect(log.error).toHaveBeenCalledOnce()
  })
})

describe('warmImage', () => {
  it('requests the warm sizes with bounded concurrency and swallows errors', async () => {
    let active = 0, peak = 0
    const fetch = vi.fn(async (url: string | URL | Request) => {
      active++; peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 2))
      active--
      if (String(url).endsWith('/48.png')) throw new Error('boom')
      return ok()
    })
    const log = vi.fn()
    await warmImage('did:plc:a', 'bafya', { publicUrl: 'https://x.test', signingSecret: 's', concurrency: 2, fetch: fetch as unknown as typeof globalThis.fetch, log })
    expect(fetch).toHaveBeenCalledTimes(5)
    expect(peak).toBeLessThanOrEqual(2)
    expect(log).toHaveBeenCalledOnce()
  })
})
