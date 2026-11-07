import { afterEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { Metrics } from '@blueyvatar/core'
import { IndexerHealth, firstNumber, probeTap, startHealthServer } from './health.js'

function clock() {
  let t = 1_000_000
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('IndexerHealth', () => {
  it('is ready at start and fails after the window with no event or heartbeat', () => {
    const c = clock()
    const h = new IndexerHealth({ windowMs: 60_000, now: c.now })
    expect(h.state().ready).toBe(true)
    c.advance(61_000)
    expect(h.state().ready).toBe(false)
    h.markHeartbeat()
    expect(h.state().ready).toBe(true)
    c.advance(61_000)
    h.markEvent(5)
    expect(h.state()).toMatchObject({ ready: true, lastEventId: 5 })
  })

  it('fails when handling keeps failing even though heartbeats arrive, and recovers on success', () => {
    const c = clock()
    const h = new IndexerHealth({ windowMs: 60_000, now: c.now })
    h.markFailure()
    for (let i = 0; i < 4; i++) { c.advance(20_000); h.markHeartbeat() }
    expect(h.state().ready).toBe(false)
    h.markEvent(9)
    expect(h.state().ready).toBe(true)
  })
})

describe('probeTap', () => {
  it('marks a heartbeat and reads the outbox buffer', async () => {
    const h = new IndexerHealth({ windowMs: 1000 })
    const seen: Array<{ url: string; auth?: string }> = []
    const f = (async (u: URL, init: RequestInit) => {
      seen.push({ url: u.pathname, auth: (init.headers as Record<string, string>).authorization })
      return u.pathname === '/health' ? new Response('{"status":"ok"}') : new Response('{"outbox_buffer":42}')
    }) as never
    expect(await probeTap({ tapUrl: 'http://tap:2480', adminPassword: 'pw', fetch: f }, h)).toBe(true)
    expect(h.state().outboxBuffer).toBe(42)
    expect(seen[0]!.auth).toBe('Basic ' + Buffer.from('admin:pw').toString('base64'))
  })

  it('does not mark a heartbeat when Tap is down or answers 401', async () => {
    const c = clock()
    const h = new IndexerHealth({ windowMs: 1000, now: c.now })
    expect(await probeTap({ tapUrl: 'http://tap:2480', fetch: (async () => { throw new Error('refused') }) as never }, h)).toBe(false)
    expect(await probeTap({ tapUrl: 'http://tap:2480', fetch: (async () => new Response('', { status: 401 })) as never }, h)).toBe(false)
    c.advance(2000)
    expect(h.state().ready).toBe(false)
  })

  it('finds a number in any response shape', () => {
    expect(firstNumber(7)).toBe(7)
    expect(firstNumber({ a: { b: 3 } })).toBe(3)
    expect(firstNumber('x')).toBeNull()
  })
})

describe('health server', () => {
  let server: Server | undefined
  afterEach(() => { server?.close() })

  it('serves liveness, readiness, and metrics', async () => {
    const c = clock()
    const health = new IndexerHealth({ windowMs: 1000, now: c.now })
    const metrics = new Metrics()
    server = startHealthServer({ health, metrics, port: 0, host: '127.0.0.1' })
    await new Promise((r) => server!.once('listening', r))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    expect((await fetch(base + '/healthz')).status).toBe(200)
    expect((await fetch(base + '/readyz')).status).toBe(200)
    c.advance(5000)
    const stalled = await fetch(base + '/readyz')
    expect(stalled.status).toBe(503)
    expect(((await stalled.json()) as { status: string }).status).toBe('stalled')
    expect(await (await fetch(base + '/metrics')).text()).toContain('indexer_ready 0')
    expect((await fetch(base + '/nope')).status).toBe(404)
  })
})
