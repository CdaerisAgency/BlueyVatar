import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { fingerprint, parseArgs, report, runSmoke, targetsFor } from './smoke.ts'

let server: Server | undefined
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())))

/** A fake that behaves like a healthy deployment. `tweak` overrides individual routes. */
async function fake(tweak: Record<string, (path: string, h: Record<string, string | string[] | undefined>) => [number, Record<string, string>, string] | undefined> = {}) {
  let imgHits = 0
  server = createServer((req, res) => {
    const path = req.url ?? '/'
    const key = `${req.method} ${path.split('?')[0]}`
    const custom = Object.entries(tweak).find(([k]) => key === k || (k.endsWith('*') && key.startsWith(k.slice(0, -1))))
    const over = custom?.[1](path, req.headers)
    let out: [number, Record<string, string>, string]
    if (over) out = over
    else if (path === '/healthz') out = [200, {}, 'ok']
    else if (path.startsWith('/avatar/')) {
      const hash = path.split('/')[2]!.split('?')[0]!
      out = [302, { location: `/default/mp/80.png?seed=${hash}`, 'cache-control': 'private, max-age=3600', 'x-request-id': Math.random().toString() }, '']
    } else if (path.startsWith('/u/')) out = [302, { location: '/img/did:plc:x/bafy123456789/sig/80.webp' }, '']
    else if (path.startsWith('/img/')) out = [200, { 'cf-cache-status': imgHits++ === 0 ? 'MISS' : 'HIT' }, 'bytes']
    else if (path.startsWith('/p/')) out = [200, {}, '<h1>Alice</h1>']
    else if (path === '/oauth-client-metadata.json') out = [200, { 'content-type': 'application/json' }, JSON.stringify({ client_id: 'x', redirect_uris: ['y'] })]
    else if (path === '/oauth/jwks.json') out = [200, { 'content-type': 'application/json' }, JSON.stringify({ keys: [{ kty: 'EC', kid: 'k' }] })]
    else if (path === '/api/stripe/webhook') out = [400, {}, '{"error":"missing_signature"}']
    else out = [404, {}, '']
    res.writeHead(out[0], out[1])
    res.end(out[2])
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { web: base, delivery: base, origin: base }
}

const opts = { handle: 'alice.test', wait: async () => {} }
const byName = (rows: Awaited<ReturnType<typeof runSmoke>>, part: string) => rows.find((r) => r.name.includes(part))!

describe('runSmoke', () => {
  it('passes against a healthy deployment, except the lockdown check that needs a 403', async () => {
    const t = await fake({ 'GET /u/x': () => [403, {}, '{"error":{"code":"origin_forbidden"}}'] })
    const rows = await runSmoke(t, opts)
    expect(rows.filter((r) => r.status === 'fail')).toEqual([])
    expect(report(rows, () => {})).toBe(true)
    expect(byName(rows, 'cache status').detail).toBe('MISS then HIT')
  })

  it('fails when the direct hostname is not locked down', async () => {
    const t = await fake()
    const rows = await runSmoke(t, opts)
    expect(byName(rows, 'direct Fly').status).toBe('fail')
    expect(report(rows, () => {})).toBe(false)
  })

  it('fails when an unlinked hash answers differently from another hash', async () => {
    const t = await fake({
      'GET /avatar/*': (path) => (path.includes('/0000') ? [302, { location: '/default/mp/80.png' }, ''] : [302, { location: '/default/mp/80.png', 'x-extra': '1' }, '']),
    })
    const rows = await runSmoke(t, { ...opts, optedOutHash: '0'.repeat(64) })
    expect(byName(rows, 'unlinked hash').status).toBe('fail')
  })

  it('fails when the CDN never serves a HIT', async () => {
    const t = await fake({ 'GET /img/*': () => [200, { 'cf-cache-status': 'MISS' }, 'x'] })
    expect(byName(await runSmoke(t, opts), 'cache status').status).toBe('fail')
  })

  it('fails when the webhook accepts an unsigned body and when JWKS leaks a private member', async () => {
    const t = await fake({
      'POST /api/stripe/webhook': () => [200, {}, '{}'],
      'GET /oauth/jwks.json': () => [200, {}, JSON.stringify({ keys: [{ kty: 'EC', d: 'secret' }] })],
    })
    const rows = await runSmoke(t, opts)
    expect(byName(rows, 'webhook').status).toBe('fail')
    expect(byName(rows, 'jwks').status).toBe('fail')
  })

  it('sends x-origin-auth on public delivery checks only', async () => {
    const seen: string[] = []
    const t = await fake({
      'GET /avatar/*': (_p, h) => (seen.push(`avatar:${h['x-origin-auth']}`), undefined),
      'GET /u/x': (_p, h) => (seen.push(`direct:${h['x-origin-auth']}`), [403, {}, 'origin_forbidden']),
    })
    await runSmoke(t, { ...opts, originSecret: 's3cret' })
    expect(seen).toContain('direct:undefined')
    expect(seen.filter((s) => s.startsWith('avatar:'))).toEqual(['avatar:s3cret', 'avatar:s3cret'])
  })

  it('skips handle checks without a handle', async () => {
    const t = await fake({ 'GET /u/x': () => [403, {}, 'origin_forbidden'] })
    const rows = await runSmoke(t, { wait: async () => {} })
    expect(rows.filter((r) => r.status === 'skip')).toHaveLength(2)
    expect(report(rows, () => {})).toBe(true)
  })
})

describe('helpers', () => {
  it('parses --env and ignores a bare --', () => {
    expect(parseArgs(['--', '--env', 'staging'])).toBe('staging')
    expect(parseArgs(['--env=production'])).toBe('production')
    expect(() => parseArgs([])).toThrow(/Usage/)
    expect(() => parseArgs(['--env', 'dev'])).toThrow(/Usage/)
  })
  it('lets variables override the default URLs', () => {
    expect(targetsFor('production', { SMOKE_WEB_URL: 'http://x/' }).web).toBe('http://x')
    expect(targetsFor('production', {}).delivery).toBe('https://img.blueyvatar.com')
  })
  it('masks the hash in the fingerprint', () => {
    const r = new Response(null, { status: 302, headers: { location: '/default/mp/80.png?seed=abc', date: 'now' } })
    expect(fingerprint(r, 'abc')).toBe('status 302\nlocation: /default/mp/80.png?seed={hash}')
  })
})
