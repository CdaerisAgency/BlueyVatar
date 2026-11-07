import { describe, expect, it } from 'vitest'
import { limitedResizer, resizeLimitsFromEnv, ResizeBusyError, type ResizeJob } from './resize.js'

const job: ResizeJob = { input: new Uint8Array(1), size: 64, format: 'png', quality: 80 }

function gate() {
  let running = 0
  let peak = 0
  const releases: Array<() => void> = []
  const inner = (): Promise<Uint8Array> => {
    running += 1
    peak = Math.max(peak, running)
    return new Promise((resolve) => releases.push(() => { running -= 1; resolve(new Uint8Array(1)) }))
  }
  return { inner, releases, peak: () => peak }
}
const tick = () => new Promise((r) => setTimeout(r, 5))

describe('limitedResizer', () => {
  it('never runs more than maxConcurrent and drains the queue in order', async () => {
    const g = gate()
    const states: Array<{ inFlight: number; queued: number }> = []
    const r = limitedResizer(g.inner, { maxConcurrent: 2, maxQueue: 5, queueWaitMs: 1000, onChange: (s) => states.push(s) })
    const all = Array.from({ length: 6 }, () => r(job))
    await tick()
    expect(g.releases).toHaveLength(2)
    while (g.releases.length) { g.releases.shift()!(); await tick() }
    await Promise.all(all)
    expect(g.peak()).toBe(2)
    expect(Math.max(...states.map((s) => s.queued))).toBe(4)
    expect(states.at(-1)).toMatchObject({ inFlight: 0, queued: 0 })
  })

  it('sheds immediately when the queue is full', async () => {
    const g = gate()
    let shed = 0
    const r = limitedResizer(g.inner, { maxConcurrent: 1, maxQueue: 1, queueWaitMs: 1000, retryAfterSeconds: 3, onChange: (s) => { if (s.shed) shed += 1 } })
    const a = r(job)
    const b = r(job)
    await tick()
    await expect(r(job)).rejects.toMatchObject({ retryAfterSeconds: 3 })
    expect(shed).toBe(1)
    g.releases.shift()!(); await tick(); g.releases.shift()!()
    await Promise.all([a, b])
  })

  it('sheds a job that waits too long and keeps the slot accounting right', async () => {
    const g = gate()
    const r = limitedResizer(g.inner, { maxConcurrent: 1, maxQueue: 5, queueWaitMs: 20 })
    const a = r(job)
    await expect(r(job)).rejects.toBeInstanceOf(ResizeBusyError)
    g.releases.shift()!()
    await a
    const c = r(job)
    await tick()
    expect(g.releases).toHaveLength(1)
    g.releases.shift()!()
    await c
  })

  it('releases the slot when the resize throws', async () => {
    const r = limitedResizer(async () => { throw new Error('boom') }, { maxConcurrent: 1, maxQueue: 0, queueWaitMs: 0 })
    await expect(r(job)).rejects.toThrow('boom')
    await expect(r(job)).rejects.toThrow('boom')
  })
})

describe('resizeLimitsFromEnv', () => {
  it('defaults to 2 concurrent for the 512 MB VM and ignores bad values', () => {
    expect(resizeLimitsFromEnv({})).toEqual({ maxConcurrent: 2, maxQueue: 8, queueWaitMs: 3000 })
    expect(resizeLimitsFromEnv({ IMG_MAX_CONCURRENT: '0', IMG_QUEUE_MAX: 'x', IMG_QUEUE_WAIT_MS: '-1' })).toEqual({ maxConcurrent: 2, maxQueue: 8, queueWaitMs: 3000 })
    expect(resizeLimitsFromEnv({ IMG_MAX_CONCURRENT: '4', IMG_QUEUE_MAX: '0', IMG_QUEUE_WAIT_MS: '500' })).toEqual({ maxConcurrent: 4, maxQueue: 0, queueWaitMs: 500 })
  })
})
