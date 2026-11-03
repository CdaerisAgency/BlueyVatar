import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { ORIGIN_AUTH_HEADER, originLock, originLockWarning, secretsEqual } from './origin.js'

function app() {
  const a = new Hono()
  a.use('*', originLock('s3cret'))
  a.get('/healthz', (c) => c.text('ok'))
  a.post('/healthz', (c) => c.text('posted'))
  a.get('/u/x', (c) => c.text('hi'))
  return a
}

describe('originLock', () => {
  it('rejects a missing header with origin_forbidden', async () => {
    const res = await app().request('/u/x')
    expect(res.status).toBe(403)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('origin_forbidden')
  })
  it('rejects a wrong header, including a different length', async () => {
    expect((await app().request('/u/x', { headers: { [ORIGIN_AUTH_HEADER]: 'nope' } })).status).toBe(403)
    expect((await app().request('/u/x', { headers: { [ORIGIN_AUTH_HEADER]: 's3cret-extra' } })).status).toBe(403)
  })
  it('accepts the right header', async () => {
    const res = await app().request('/u/x', { headers: { [ORIGIN_AUTH_HEADER]: 's3cret' } })
    expect(res.status).toBe(200)
  })
  it('exempts only GET /healthz', async () => {
    expect((await app().request('/healthz')).status).toBe(200)
    expect((await app().request('/healthz', { method: 'POST' })).status).toBe(403)
  })
  it('compares in constant-time helper', () => {
    expect(secretsEqual('a', 'a')).toBe(true)
    expect(secretsEqual('a', 'b')).toBe(false)
  })
})

describe('originLockWarning', () => {
  it('warns only when Cloudflare is trusted and no secret is set', () => {
    expect(originLockWarning({ TRUST_CLOUDFLARE: 'true' })).toContain('ORIGIN_SECRET')
    expect(originLockWarning({ TRUST_CLOUDFLARE: 'true', ORIGIN_SECRET: 'x' })).toBeNull()
    expect(originLockWarning({})).toBeNull()
  })
})
