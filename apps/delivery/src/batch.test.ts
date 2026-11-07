import { describe, expect, it } from 'vitest'
import { BatchedRateLimiter, BatchedUsageMeter } from './batch.js'
import { MemoryRateLimiter } from './licenses.js'
import { MemoryUsageMeter } from './usage.js'

class CountingLimiter extends MemoryRateLimiter {
  calls = 0
  fail = false
  async hit(bucket: string, limit: number, windowSeconds: number, n = 1) {
    this.calls += 1
    if (this.fail) throw new Error('db down')
    return super.hit(bucket, limit, windowSeconds, n)
  }
}

describe('BatchedRateLimiter', () => {
  it('writes through once per window and then counts locally', async () => {
    let t = 1_000_000
    const inner = new CountingLimiter(() => Math.floor(t / 1000))
    const rl = new BatchedRateLimiter(inner, { flushMs: 0, now: () => t })
    for (let i = 0; i < 50; i++) await rl.hit('ip:a', 100, 60)
    expect(inner.calls).toBe(1)
    await rl.flush()
    expect(inner.calls).toBe(2)
    const w = await rl.hit('ip:a', 100, 60)
    expect(w.remaining).toBe(100 - 51)
  })

  it('rejects past the limit using the local count', async () => {
    const t = 5_000_000
    const rl = new BatchedRateLimiter(new CountingLimiter(() => Math.floor(t / 1000)), { flushMs: 0, now: () => t })
    const results = []
    for (let i = 0; i < 5; i++) results.push((await rl.hit('b', 3, 60)).exceeded)
    expect(results).toEqual([false, false, false, true, true])
  })

  it('picks up other machines after a flush', async () => {
    const t = 7_000_000
    const inner = new CountingLimiter(() => Math.floor(t / 1000))
    const rl = new BatchedRateLimiter(inner, { flushMs: 0, now: () => t })
    await rl.hit('b', 10, 60)
    await inner.hit('b', 10, 60, 7) // another machine
    await rl.hit('b', 10, 60)
    await rl.flush()
    const w = await rl.hit('b', 10, 60)
    expect(w.remaining).toBe(0) // 1 + 7 + 1 + this one = 10
  })

  it('starts a fresh window after reset and drops stale pending counts', async () => {
    let t = 9_000_000
    const inner = new CountingLimiter(() => Math.floor(t / 1000))
    const rl = new BatchedRateLimiter(inner, { flushMs: 0, now: () => t })
    await rl.hit('b', 5, 10)
    await rl.hit('b', 5, 10)
    t += 11_000
    const w = await rl.hit('b', 5, 10)
    expect(w.remaining).toBe(4)
    await rl.flush()
    expect(rl.size).toBe(1)
  })

  it('keeps increments queued when a flush fails', async () => {
    const t = 11_000_000
    const inner = new CountingLimiter(() => Math.floor(t / 1000))
    const errors: unknown[] = []
    const rl = new BatchedRateLimiter(inner, { flushMs: 0, now: () => t, onError: (e) => errors.push(e) })
    await rl.hit('b', 100, 60)
    await rl.hit('b', 100, 60)
    inner.fail = true
    await rl.flush()
    expect(errors).toHaveLength(1)
    inner.fail = false
    await rl.flush()
    expect((await inner.hit('b', 100, 60, 0)).remaining).toBe(98)
  })
})

describe('BatchedUsageMeter', () => {
  it('writes through on first use, then batches, and returns a running total', async () => {
    const inner = new MemoryUsageMeter()
    let writes = 0
    const orig = inner.add.bind(inner)
    inner.add = async (...a) => { writes += 1; return orig(...a) }
    const um = new BatchedUsageMeter(inner, { flushMs: 0 })
    let last = 0
    for (let i = 0; i < 100; i++) last = await um.add('lic', 'origin_resolution')
    expect(last).toBe(100)
    expect(writes).toBe(1)
    await um.flush()
    expect(writes).toBe(2)
    expect(inner.counts.get('lic:origin_resolution')).toBe(100)
  })

  it('batches service and profile counters and flushes them on close', async () => {
    const inner = new MemoryUsageMeter()
    const um = new BatchedUsageMeter(inner, { flushMs: 0 })
    for (let i = 0; i < 3; i++) await um.addService('did:plc:x', 'transform')
    await um.addService('did:plc:x', 'bytes_delivered', 500)
    for (let i = 0; i < 4; i++) await um.addProfileCall('did:plc:x')
    expect(inner.service.size).toBe(0)
    await um.close()
    expect(inner.service.get('did:plc:x:transform')).toBe(3)
    expect(inner.service.get('did:plc:x:bytes_delivered')).toBe(500)
    expect([...inner.profileCalls.values()]).toEqual([4])
  })
})
