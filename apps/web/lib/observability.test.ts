import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as health } from '../app/api/health/route'
import { GET as metricsRoute } from '../app/api/metrics/route'
import { proxy } from '../proxy'
import { errors, metrics, reportError } from './obs'

describe('web observability', () => {
  it('proxy adds x-request-id to the response and keeps a safe incoming one', async () => {
    const a = await proxy(new NextRequest('http://localhost:3000/'))
    expect(a.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
    const b = await proxy(new NextRequest('http://localhost:3000/api/health', { headers: { 'x-request-id': 'trace-abcdef12' } }))
    expect(b.headers.get('x-request-id')).toBe('trace-abcdef12')
  })

  it('/api/health answers ok without a database and echoes the id', async () => {
    const saved = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      const r = await health(new Request('http://localhost/api/health', { headers: { 'x-request-id': 'trace-abcdef12' } }))
      expect(r.status).toBe(200)
      expect(r.headers.get('x-request-id')).toBe('trace-abcdef12')
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved
    }
  })

  it('/api/metrics is hidden without a matching token', async () => {
    delete process.env.METRICS_TOKEN
    expect((await metricsRoute(new Request('http://localhost/api/metrics'))).status).toBe(404)
    process.env.METRICS_TOKEN = 'tok'
    try {
      expect((await metricsRoute(new Request('http://localhost/api/metrics', { headers: { authorization: 'Bearer nope' } }))).status).toBe(404)
      metrics.inc('web_stripe_webhook_total', { result: 'ok' })
      const ok = await metricsRoute(new Request('http://localhost/api/metrics', { headers: { authorization: 'Bearer tok' } }))
      expect(await ok.text()).toContain('web_stripe_webhook_total{result="ok"}')
    } finally {
      delete process.env.METRICS_TOKEN
    }
  })

  it('reportError logs JSON without raw email or tokens and does nothing remote without a DSN', () => {
    expect(errors.enabled).toBe(false)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    reportError('claim add failed', new Error('bad for who@x.test Bearer abc123'))
    const line = String(spy.mock.calls[0]![0])
    spy.mockRestore()
    expect(JSON.parse(line)).toMatchObject({ level: 'error', app: 'web', msg: 'claim add failed' })
    expect(line).not.toMatch(/who@x\.test|abc123/)
  })
})
