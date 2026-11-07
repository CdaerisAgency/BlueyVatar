import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { create as mhCreate } from 'multiformats/hashes/digest'
import { BlobError, ByteLru, NegativeCache, normalizePdsEndpoint, parseMb } from './blob.js'
import { AtprotoResolver, type Identity } from './resolver.js'
import { MemoryIndexStore } from './store.js'

const bytes = new Uint8Array([1, 2, 3, 4])
const cid = CID.createV1(raw.code, mhCreate(0x12, createHash('sha256').update(bytes).digest())).toString()
const ident = (pds: string): Identity => ({ did: 'did:plc:abc123', handle: null, pds })

function setup(responses: Array<Response | Error>, opts: Partial<ConstructorParameters<typeof AtprotoResolver>[0]> = {}) {
  const urls: string[] = []
  const logs: Array<Record<string, unknown>> = []
  let i = 0
  const fetch = (async (url: URL) => {
    urls.push(String(url))
    const r = responses[Math.min(i++, responses.length - 1)]!
    if (r instanceof Error) throw r
    return r.clone()
  }) as unknown as typeof globalThis.fetch
  const sleeps: number[] = []
  const resolver = new AtprotoResolver({
    index: new MemoryIndexStore(), adapters: [], fetch,
    log: (_m, meta) => logs.push(meta ?? {}),
    sleep: async (ms) => { sleeps.push(ms) },
    ...opts,
  })
  return { resolver, urls, logs, sleeps }
}
const ok = () => new Response(bytes)
const status = (n: number) => new Response('x', { status: n })
const timeout = () => Object.assign(new Error('t'), { name: 'TimeoutError' })

describe('normalizePdsEndpoint', () => {
  it('accepts https and adds a scheme to bare hosts', () => {
    expect(normalizePdsEndpoint('https://pds.test/')?.href).toBe('https://pds.test/')
    expect(normalizePdsEndpoint('pds.shatteredsky.net')?.href).toBe('https://pds.shatteredsky.net/')
  })
  it.each(['http://pds.test', 'ftp://pds.test', 'https://localhost', 'https://127.0.0.1', 'https://[::1]',
    'https://10.0.0.5', 'https://169.254.169.254', 'https://user:pw@pds.test', 'https://pds.test:8443',
    'foo.internal', '', 'a b', 'javascript:alert(1)'])('rejects %s', (v) => {
    expect(normalizePdsEndpoint(v)).toBeNull()
  })
  it('rejects non-strings', () => expect(normalizePdsEndpoint(undefined)).toBeNull())
})

describe('getBlob', () => {
  it('fetches and normalizes a scheme-less endpoint', async () => {
    const { resolver, urls } = setup([ok()])
    expect(await resolver.getBlob(ident('pds.shatteredsky.net'), cid)).toEqual(bytes)
    expect(urls[0]).toMatch(/^https:\/\/pds\.shatteredsky\.net\/xrpc\/com\.atproto\.sync\.getBlob\?/)
  })
  it('rejects an invalid endpoint without fetching', async () => {
    const { resolver, urls, logs } = setup([ok()])
    await expect(resolver.getBlob(ident('http://127.0.0.1'), cid)).rejects.toMatchObject({ kind: 'invalid_endpoint' })
    expect(urls).toHaveLength(0)
    expect(logs[0]!.outcome).toBe('invalid_endpoint')
  })
  it('maps 404 to not_found with no retry', async () => {
    const { resolver, urls } = setup([status(404)])
    await expect(resolver.getBlob(ident('https://pds.test'), cid)).rejects.toMatchObject({ kind: 'not_found' })
    expect(urls).toHaveLength(1)
  })
  it('does not retry other 4xx and does not negative-cache', async () => {
    const { resolver, urls } = setup([status(403)])
    await expect(resolver.getBlob(ident('https://pds.test'), cid)).rejects.toMatchObject({ kind: 'upstream', status: 403 })
    await expect(resolver.getBlob(ident('https://pds.test'), cid)).rejects.toMatchObject({ kind: 'upstream' })
    expect(urls).toHaveLength(2)
  })
  it('retries 5xx then succeeds, with backoff', async () => {
    const { resolver, urls, sleeps } = setup([status(503), status(500), ok()])
    expect(await resolver.getBlob(ident('https://pds.test'), cid)).toEqual(bytes)
    expect(urls).toHaveLength(3)
    expect(sleeps).toEqual([100, 300])
  })
  it('retries network errors and timeouts, then fails with upstream', async () => {
    const { resolver, urls, logs } = setup([new Error('ECONNRESET'), timeout(), timeout()])
    await expect(resolver.getBlob(ident('https://pds.test'), cid)).rejects.toMatchObject({ kind: 'upstream' })
    expect(urls).toHaveLength(3)
    expect(logs.map((l) => l.outcome)).toEqual(['network_error', 'timeout', 'timeout'])
  })
  it('fails after 2 retries on persistent 5xx', async () => {
    const { resolver, urls } = setup([status(502)])
    await expect(resolver.getBlob(ident('https://pds.test'), cid)).rejects.toMatchObject({ kind: 'upstream', status: 502 })
    expect(urls).toHaveLength(3)
  })
  it('negative-caches a failing host, per host only', async () => {
    const { resolver, urls, logs } = setup([status(500)])
    await expect(resolver.getBlob(ident('https://bad.test'), cid)).rejects.toBeInstanceOf(BlobError)
    const before = urls.length
    await expect(resolver.getBlob(ident('https://bad.test'), cid)).rejects.toMatchObject({ kind: 'upstream' })
    expect(urls.length).toBe(before)
    expect(logs.at(-1)!.outcome).toBe('negative_cache')
    await expect(resolver.getBlob(ident('https://other.test'), cid)).rejects.toBeInstanceOf(BlobError)
    expect(urls.length).toBeGreaterThan(before)
  })
  it('rejects bytes that do not match the CID and does not cache them', async () => {
    const { resolver, urls } = setup([new Response(new Uint8Array([9]))])
    await expect(resolver.getBlob(ident('https://pds.test'), cid)).rejects.toMatchObject({ kind: 'upstream' })
    await expect(resolver.getBlob(ident('https://pds.test'), cid)).rejects.toBeInstanceOf(BlobError)
    expect(urls).toHaveLength(2)
  })
  it('serves repeat reads from the original cache', async () => {
    const { resolver, urls, logs } = setup([ok()])
    await resolver.getBlob(ident('https://pds.test'), cid)
    await resolver.getBlob(ident('https://pds.test'), cid)
    expect(urls).toHaveLength(1)
    expect(logs.at(-1)!.outcome).toBe('cache_hit')
  })
  it('skips the cache when the cap is 0', async () => {
    const { resolver, urls } = setup([ok()], { blobCacheMb: 0 })
    await resolver.getBlob(ident('https://pds.test'), cid)
    await resolver.getBlob(ident('https://pds.test'), cid)
    expect(urls).toHaveLength(2)
  })
  it('logs a fixed shape without secrets', async () => {
    const { resolver, logs } = setup([ok()])
    await resolver.getBlob(ident('https://pds.test'), cid)
    expect(Object.keys(logs[0]!).sort()).toEqual(['attempt', 'bytes', 'cid', 'did', 'host', 'outcome', 'status'])
  })
})

describe('caches', () => {
  it('NegativeCache expires and caps', () => {
    let t = 0
    const c = new NegativeCache(30_000, 2, () => t)
    c.add('a'); c.add('b'); c.add('c')
    expect(c.has('a')).toBe(false)
    expect(c.has('c')).toBe(true)
    t = 30_001
    expect(c.has('c')).toBe(false)
  })
  it('ByteLru evicts least recently used and skips oversized', () => {
    const l = new ByteLru(10)
    l.set('a', new Uint8Array(4)); l.set('b', new Uint8Array(4))
    l.get('a')
    l.set('c', new Uint8Array(4))
    expect(l.get('b')).toBeUndefined()
    expect(l.get('a')).toBeDefined()
    l.set('big', new Uint8Array(11))
    expect(l.get('big')).toBeUndefined()
    expect(l.size).toBe(8)
  })
  it('parseMb falls back on bad input', () => {
    expect(parseMb(undefined, 32)).toBe(32)
    expect(parseMb('abc', 32)).toBe(32)
    expect(parseMb('-1', 32)).toBe(32)
    expect(parseMb('8', 32)).toBe(8)
    expect(parseMb('0', 32)).toBe(0)
  })
})
