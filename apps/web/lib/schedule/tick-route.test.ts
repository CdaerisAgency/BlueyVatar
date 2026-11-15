import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tick = vi.fn(async () => 'applied')
vi.mock('./flow', () => ({ tickSchedule: tick }))
vi.mock('./live', () => ({ liveScheduleDeps: vi.fn(async () => ({})) }))
vi.mock('../obs', () => ({ reportError: vi.fn() }))

const post = (body: unknown, auth?: string) =>
  new Request('http://x.test/account/avatars/schedule/tick', { method: 'POST', headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) })

describe('schedule tick route', () => {
  beforeEach(() => {
    process.env.EFFECTS_TICK_SECRET = 's3cret'
    tick.mockClear()
  })
  afterEach(() => {
    delete process.env.EFFECTS_TICK_SECRET
  })
  it('is off (404) without the secret', async () => {
    delete process.env.EFFECTS_TICK_SECRET
    const { POST } = await import('../../app/account/avatars/schedule/tick/route')
    expect((await POST(post({ did: 'did:plc:a' }, 'Bearer s3cret'))).status).toBe(404)
  })
  it('refuses a missing or wrong token', async () => {
    const { POST } = await import('../../app/account/avatars/schedule/tick/route')
    expect((await POST(post({ did: 'did:plc:a' }))).status).toBe(401)
    expect((await POST(post({ did: 'did:plc:a' }, 'Bearer nope'))).status).toBe(401)
    expect(tick).not.toHaveBeenCalled()
  })
  it('rejects a bad did and runs one step for a good one', async () => {
    const { POST } = await import('../../app/account/avatars/schedule/tick/route')
    expect((await POST(post({ did: 'nope' }, 'Bearer s3cret'))).status).toBe(400)
    const res = await POST(post({ did: 'did:plc:a' }, 'Bearer s3cret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: 'applied' })
    expect(tick).toHaveBeenCalledTimes(1)
  })
})
