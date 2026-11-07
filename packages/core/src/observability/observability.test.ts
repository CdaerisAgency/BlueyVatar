import { describe, expect, it } from 'vitest'
import { Metrics, buildEvent, createErrorTracker, createLogger, didHash, parseDsn, requestIdFrom, scrubHeaders, scrubUrl } from './index.js'

function capture() {
  const lines: Array<{ level: string; obj: Record<string, unknown> }> = []
  const log = createLogger({ app: 'test', level: 'debug', write: (level, line) => lines.push({ level, obj: JSON.parse(line) }) })
  return { lines, log }
}

describe('logger', () => {
  it('writes JSON with level, app, and time', () => {
    const { lines, log } = capture()
    log.info('hello', { n: 1 })
    expect(lines[0]!.obj).toMatchObject({ level: 'info', app: 'test', msg: 'hello', n: 1 })
    expect(typeof lines[0]!.obj.time).toBe('string')
  })

  it('replaces did with its hash and redacts credentials and email', () => {
    const { lines, log } = capture()
    log.warn('x', { did: 'did:plc:abc', email: 'a@b.com', authorization: 'Bearer abc', nested: { apiKey: 'k', cookie: 'c' }, note: 'mail a@b.com with Bearer tok123' })
    const o = lines[0]!.obj
    expect(o.did).toBeUndefined()
    expect(o.didHash).toBe(didHash('did:plc:abc'))
    expect(JSON.stringify(o)).not.toMatch(/a@b\.com|tok123|did:plc:abc|"k"|"c"/)
  })

  it('honors the minimum level and child fields', () => {
    const lines: string[] = []
    const log = createLogger({ app: 't', level: 'warn', write: (_l, s) => lines.push(s) }).child({ requestId: 'r1' })
    log.info('no')
    log.error('yes')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!).requestId).toBe('r1')
  })

  it('serializes errors as name and message only', () => {
    const { lines, log } = capture()
    log.error('boom', { err: new Error('bad') })
    expect(lines[0]!.obj.err).toEqual({ name: 'Error', message: 'bad' })
  })
})

describe('request id', () => {
  it('keeps a safe incoming id and replaces junk', () => {
    expect(requestIdFrom('abc12345-xyz')).toBe('abc12345-xyz')
    expect(requestIdFrom('bad id\nx')).toMatch(/^[0-9a-f-]{36}$/)
    expect(requestIdFrom(undefined)).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('metrics', () => {
  it('renders counters, gauges, and histograms', () => {
    const m = new Metrics()
    m.describe('x_total', 'things')
    m.inc('x_total', { kind: 'a' })
    m.inc('x_total', { kind: 'a' }, 2)
    m.set('lag', 7)
    m.observe('dur_ms', 30, { route: 'r' })
    const out = m.render()
    expect(out).toContain('# HELP x_total things')
    expect(out).toContain('x_total{kind="a"} 3')
    expect(out).toContain('lag 7')
    expect(out).toContain('dur_ms_bucket{route="r",le="50"} 1')
    expect(out).toContain('dur_ms_count{route="r"} 1')
  })
})

describe('sentry', () => {
  it('parses a DSN and rejects junk', () => {
    expect(parseDsn('https://pub@o1.ingest.sentry.io/42')?.endpoint).toBe('https://o1.ingest.sentry.io/api/42/envelope/')
    expect(parseDsn('')).toBeNull()
    expect(parseDsn(undefined)).toBeNull()
    expect(parseDsn('nonsense')).toBeNull()
  })

  it('is a no-op without a DSN', async () => {
    const calls: unknown[] = []
    const t = createErrorTracker({ app: 'x', fetch: (async (...a: unknown[]) => { calls.push(a) }) as never })
    expect(t.enabled).toBe(false)
    expect(t.captureException(new Error('x'))).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('posts a scrubbed envelope', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const t = createErrorTracker({
      dsn: 'https://pub@host.example/7',
      app: 'delivery',
      fetch: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}') }) as never,
    })
    t.captureException(new Error('failed for a@b.com'), {
      requestId: 'req-1',
      method: 'GET',
      url: 'https://x.test/avatar/h?token=sekret&s=64',
      headers: { authorization: 'Bearer abc', 'x-api-key': 'k', cookie: 'sid=1', accept: '*/*' },
    })
    await t.flush()
    expect(calls[0]!.url).toBe('https://host.example/api/7/envelope/')
    const body = String(calls[0]!.init.body)
    expect(body).not.toMatch(/a@b\.com|sekret|Bearer abc|sid=1|"k"/)
    expect(body).toContain('"request_id":"req-1"')
    expect(body).toContain('"accept":"*/*"')
    expect((calls[0]!.init.headers as Record<string, string>)['x-sentry-auth']).toContain('sentry_key=pub')
  })

  it('never throws when the transport fails', async () => {
    const t = createErrorTracker({ dsn: 'https://pub@host.example/7', app: 'x', fetch: (async () => { throw new Error('down') }) as never })
    expect(() => t.captureException(new Error('x'))).not.toThrow()
    await t.flush()
  })

  it('builds stack frames', () => {
    const e = buildEvent(new Error('x'), { app: 'a' })
    expect(e.exception.values[0]!.stacktrace?.frames.length).toBeGreaterThan(0)
  })
})

describe('scrub helpers', () => {
  it('scrubs headers and urls', () => {
    expect(scrubHeaders({ Authorization: 'x', Accept: 'y' })).toEqual({ authorization: '[redacted]', accept: 'y' })
    expect(scrubUrl('/a?token=1&s=2')).toBe('/a?token=%5Bredacted%5D&s=2')
  })
})
