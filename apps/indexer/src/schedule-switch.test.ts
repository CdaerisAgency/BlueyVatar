import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { SCHEDULE_BATCH, runScheduleSwitch } from './schedule-switch.js'

const NOW = new Date('2026-11-14T12:00:00Z')
const fakePool = (dids: string[]) => ({ query: vi.fn(async () => ({ rows: dids.map((did) => ({ did })) })) }) as unknown as pg.Pool

describe('schedule switch job', () => {
  it('does nothing without a secret', async () => {
    const f = vi.fn()
    expect(await runScheduleSwitch(fakePool(['did:plc:a']), {}, f as unknown as typeof fetch, NOW)).toEqual({ due: 0, called: 0, failed: 0 })
    expect(f).not.toHaveBeenCalled()
  })
  it('posts one authorized call per due account to the schedule route', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    const pool = fakePool(['did:plc:a', 'did:plc:b'])
    const r = await runScheduleSwitch(pool, { EFFECTS_TICK_SECRET: 's3', PUBLIC_URL: 'https://x.test/' }, f as unknown as typeof fetch, NOW)
    expect(r).toEqual({ due: 2, called: 2, failed: 0 })
    const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }]
    expect(url).toBe('https://x.test/account/avatars/schedule/tick')
    expect(init.headers.authorization).toBe('Bearer s3')
    expect(JSON.parse(init.body)).toEqual({ did: 'did:plc:a' })
    expect((pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toEqual([NOW, SCHEDULE_BATCH])
  })
  it('counts refusals and network errors and keeps going', async () => {
    let n = 0
    const f = vi.fn(async () => {
      if (++n === 1) throw new Error('down')
      return new Response('no', { status: 500 })
    })
    expect(await runScheduleSwitch(fakePool(['did:plc:a', 'did:plc:b']), { EFFECTS_TICK_SECRET: 's' }, f as unknown as typeof fetch, NOW)).toEqual({ due: 2, called: 0, failed: 2 })
  })
})
