import { describe, expect, it, vi } from 'vitest'
import { IMAGE_SIZE_LADDER, WARM_SIZES, imagePath } from '@blueyvatar/core'
import { CloudflarePurger } from './cloudflare.js'
import { warmImage } from './warm.js'

const ok = () => new Response('{}', { status: 200 })

describe('CloudflarePurger', () => {
  it('purges the size ladder by URL in batches of at most 100', async () => {
    const fetch = vi.fn(async () => ok())
    const p = new CloudflarePurger({ zoneId: 'z', apiToken: 't', publicUrl: 'https://blueyvatar.com/', fetch })
    await p.purge('did:plc:a', ['bafya', 'bafyb', 'bafyc'])
    const bodies = fetch.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string).files as string[])
    expect(bodies.map((b) => b.length)).toEqual([100, 100, 25])
    expect(bodies[0]![0]).toBe('https://blueyvatar.com/img/did%3Aplc%3Aa/bafya/16.png')
    expect(fetch.mock.calls[0]![0]).toBe('https://api.cloudflare.com/client/v4/zones/z/purge_cache')
  })
  it('purges exactly the canonical URLs: ladder sizes, with each allowed quality for JPEG and WebP', async () => {
    const fetch = vi.fn(async () => ok())
    await new CloudflarePurger({ zoneId: 'z', apiToken: 't', publicUrl: 'https://blueyvatar.com', fetch }).purge('did:plc:a', ['bafya'])
    const files = JSON.parse((fetch.mock.calls[0]![1] as RequestInit).body as string).files as string[]
    const base = 'https://blueyvatar.com/img/did%3Aplc%3Aa/bafya/'
    expect(files).toHaveLength(IMAGE_SIZE_LADDER.length * 5)
    expect(new Set(files).size).toBe(files.length)
    expect(files).toContain(`${base}2048.png`)
    expect(files).toContain(`${base}128.webp`)
    expect(files).toContain(`${base}128-q60.webp`)
    expect(files).toContain(`${base}128-q60.jpeg`)
    expect(files.some((f) => f.includes('?') || f.endsWith('-q60.png') || f.includes('-q85'))).toBe(false)
    const sizes = files.map((f) => Number(/\/(\d+)(?:-q\d+)?\.[a-z]+$/.exec(f)![1]))
    expect(sizes.every((s) => (IMAGE_SIZE_LADDER as readonly number[]).includes(s))).toBe(true)
  })
  it('supports prefix mode', async () => {
    const fetch = vi.fn(async () => ok())
    await new CloudflarePurger({ zoneId: 'z', apiToken: 't', publicUrl: 'https://blueyvatar.com', mode: 'prefix', fetch }).purge('did:plc:a', ['bafya'])
    expect(JSON.parse((fetch.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ prefixes: ['blueyvatar.com/img/did%3Aplc%3Aa/bafya/'] })
  })
  it('retries, then logs and gives up without throwing', async () => {
    const fetch = vi.fn(async () => new Response('no', { status: 500 }))
    const log = { info: vi.fn(), error: vi.fn() }
    await new CloudflarePurger({ zoneId: 'z', apiToken: 't', publicUrl: 'https://x.test', retries: 3, retryDelayMs: 1, fetch, log }).purge('did:plc:a', ['bafya'])
    expect(fetch).toHaveBeenCalledTimes(3) // 75 URLs fit one request
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
    await warmImage('did:plc:a', 'bafya', { publicUrl: 'https://x.test', concurrency: 2, fetch: fetch as unknown as typeof globalThis.fetch, log })
    expect(fetch).toHaveBeenCalledTimes(5)
    expect(peak).toBeLessThanOrEqual(2)
    expect(log).toHaveBeenCalledOnce()
  })
  it('requests only canonical ladder URLs without query strings', async () => {
    const urls: string[] = []
    const fetch = vi.fn(async (url: string | URL | Request) => { urls.push(String(url)); return ok() })
    await warmImage('did:plc:a', 'bafya', { publicUrl: 'https://x.test/', fetch: fetch as unknown as typeof globalThis.fetch })
    expect(urls.sort()).toEqual(WARM_SIZES.map((s) => `https://x.test${imagePath('did:plc:a', 'bafya', s, 'png')}`).sort())
  })
})
