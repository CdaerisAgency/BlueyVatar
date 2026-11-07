import { describe, expect, it } from 'vitest'
import { BusyError, limitConcurrency, resizeLimitsFromEnv } from './concurrency.js'

describe('limitConcurrency', () => {
  it('runs at most maxConcurrent at once and sheds past the queue', async () => {
    const releases: Array<() => void> = []
    let running = 0
    let peak = 0
    const run = limitConcurrency(
      () => new Promise<void>((resolve) => { running++; peak = Math.max(peak, running); releases.push(() => { running--; resolve() }) }),
      { maxConcurrent: 1, maxQueue: 1, queueWaitMs: 1000, retryAfterSeconds: 3 },
    )
    const a = run()
    const b = run()
    await expect(run()).rejects.toMatchObject({ retryAfterSeconds: 3 })
    await expect(run()).rejects.toBeInstanceOf(BusyError)
    while (releases.length) { releases.shift()!(); await new Promise((r) => setTimeout(r, 5)) }
    await Promise.all([a, b])
    expect(peak).toBe(1)
  })
  it('sheds a job that waits too long', async () => {
    const run = limitConcurrency(() => new Promise<void>(() => {}), { maxConcurrent: 1, maxQueue: 2, queueWaitMs: 10 })
    void run()
    await expect(run()).rejects.toBeInstanceOf(BusyError)
  })
})

describe('resizeLimitsFromEnv', () => {
  it('reads the env and falls back to the defaults', () => {
    expect(resizeLimitsFromEnv({ IMG_MAX_CONCURRENT: '4', IMG_QUEUE_MAX: '0', IMG_QUEUE_WAIT_MS: 'x' })).toEqual({ maxConcurrent: 4, maxQueue: 0, queueWaitMs: 3000 })
    expect(resizeLimitsFromEnv({}, { maxConcurrent: 1, maxQueue: 4, queueWaitMs: 5000 })).toEqual({ maxConcurrent: 1, maxQueue: 4, queueWaitMs: 5000 })
  })
})
