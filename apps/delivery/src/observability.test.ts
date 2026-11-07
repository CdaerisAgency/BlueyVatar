import { describe, expect, it } from 'vitest'
import { Metrics, createErrorTracker, createLogger } from '@blueyvatar/core'
import { createApp, type AppDeps } from './app.js'
import { MemoryLicenseStore, MemoryRateLimiter } from './licenses.js'
import { resolverLog } from './obs.js'
import { MemoryIndexStore } from './store.js'
import { MemoryUsageMeter } from './usage.js'

function build(over: Partial<AppDeps> = {}) {
  const lines: Array<Record<string, unknown>> = []
  const metrics = new Metrics()
  const deps: AppDeps = {
    index: new MemoryIndexStore(),
    resolver: {
      resolveIdentity: async () => null, candidates: async () => [], galleryItems: async () => [],
      getRecord: async () => null, getBlob: async () => new Uint8Array(),
    },
    licenses: new MemoryLicenseStore([]),
    limiter: new MemoryRateLimiter(),
    usage: new MemoryUsageMeter(),
    resize: async () => new Uint8Array(),
    defaultUrlAllowlist: [],
    trustCloudflare: false,
    imgSigningSecret: 's',
    logger: createLogger({ app: 'delivery', write: (_l, s) => lines.push(JSON.parse(s)) }),
    metrics,
    ...over,
  }
  return { app: createApp(deps), lines, metrics }
}

describe('request id', () => {
  it('generates an id and echoes a safe incoming one', async () => {
    const { app } = build()
    const a = await app.request('/avatar/nothex')
    expect(a.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
    const b = await app.request('/avatar/nothex', { headers: { 'x-request-id': 'trace-abcdef12' } })
    expect(b.headers.get('x-request-id')).toBe('trace-abcdef12')
    const c = await app.request('/avatar/nothex', { headers: { 'x-request-id': 'bad id' } })
    expect(c.headers.get('x-request-id')).not.toBe('bad id')
  })

  it('puts the id in 5xx error JSON but keeps 4xx bodies identical across requests', async () => {
    const x = await build().app.request('/avatar/nothex')
    const y = await build().app.request('/avatar/nothex')
    expect(await x.json()).toEqual(await y.json())
    const { app } = build({ ready: async () => { throw new Error('down') } })
    const r = await app.request('/readyz')
    expect(((await r.json()) as { error: { request_id: string } }).error.request_id).toBe(r.headers.get('x-request-id'))
  })

  it('is present on origin lock rejections', async () => {
    const { app } = build({ originSecret: 'k' })
    const r = await app.request('/u/alice.test')
    expect(r.status).toBe(403)
    expect(r.headers.get('x-request-id')).toBeTruthy()
  })
})

describe('readiness', () => {
  it('stays up on /healthz when readiness fails, and /readyz answers 503', async () => {
    const { app, metrics } = build({ ready: async () => { throw new Error('connection refused') } })
    expect((await app.request('/healthz')).status).toBe(200)
    const r = await app.request('/readyz')
    expect(r.status).toBe(503)
    expect(metrics.counter('delivery_readyz_failures_total')).toBe(1)
  })

  it('answers 200 when the probe passes and times out slow probes', async () => {
    expect((await build({ ready: async () => {} }).app.request('/readyz')).status).toBe(200)
    const slow = build({ ready: () => new Promise(() => {}), readyTimeoutMs: 20 })
    expect((await slow.app.request('/readyz')).status).toBe(503)
  })

  it('is exempt from the origin lock like /healthz', async () => {
    expect((await build({ originSecret: 'k' }).app.request('/readyz')).status).toBe(200)
  })
})

describe('metrics endpoint and counters', () => {
  it('is hidden without a token and served with one', async () => {
    const off = build()
    expect((await off.app.request('/metrics')).status).toBe(404)
    const on = build({ metricsToken: 'tok' })
    expect((await on.app.request('/metrics')).status).toBe(404)
    expect((await on.app.request('/metrics', { headers: { authorization: 'Bearer wrong' } })).status).toBe(404)
    await on.app.request('/healthz')
    const ok = await on.app.request('/metrics', { headers: { authorization: 'Bearer tok' } })
    expect(ok.status).toBe(200)
    expect(await ok.text()).toContain('delivery_http_requests_total{route="/healthz",status="2xx"} 1')
  })

  it('counts rate limit rejections', async () => {
    const { app, metrics } = build()
    let limited = 0
    for (let i = 0; i < 400; i++) {
      const r = await app.request('/avatar/' + 'a'.repeat(64), { headers: { 'x-forwarded-for': '1.1.1.1' } })
      if (r.status === 429) limited++
    }
    expect(limited).toBeGreaterThan(0)
    expect(metrics.counter('delivery_rate_limit_rejections_total')).toBe(limited)
  })

  it('maps resolver log lines to metrics', () => {
    const m = new Metrics()
    resolverLog('getBlob', { outcome: 'cache_hit' }, m)
    resolverLog('getBlob', { outcome: 'timeout' }, m)
    resolverLog('getBlob', { outcome: 'ok' }, m)
    expect(m.counter('delivery_blob_cache_hits_total')).toBe(1)
    expect(m.counter('delivery_blob_failures_total', { outcome: 'timeout' })).toBe(1)
  })
})

describe('error tracking', () => {
  it('reports unhandled errors with a scrubbed request', async () => {
    const sent: string[] = []
    const errors = createErrorTracker({
      dsn: 'https://pub@host.example/1', app: 'delivery',
      fetch: (async (_u: string, init: RequestInit) => { sent.push(String(init.body)); return new Response('') }) as never,
    })
    const { app, lines } = build({
      errors,
      resolver: { resolveIdentity: async () => { throw new Error('boom') }, candidates: async () => [], galleryItems: async () => [], getRecord: async () => null, getBlob: async () => new Uint8Array() },
    })
    const r = await app.request('/u/alice.test?utm=1', { headers: { authorization: 'Bearer abc', cookie: 'a=b' } })
    expect(r.status).toBe(500)
    await errors.flush()
    expect(sent).toHaveLength(1)
    expect(sent[0]).not.toMatch(/Bearer abc|a=b/)
    expect(sent[0]).toContain(r.headers.get('x-request-id')!)
    expect(lines.some((l) => l.msg === 'unhandled error' && l.level === 'error')).toBe(true)
  })
})
