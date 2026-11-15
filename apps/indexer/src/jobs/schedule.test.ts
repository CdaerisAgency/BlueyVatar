import { afterEach, describe, expect, it, vi } from 'vitest'
import { scheduleJob } from './schedule.js'

afterEach(() => vi.useRealTimers())

describe('scheduleJob', () => {
  it('runs at start and on the interval, and never overlaps itself', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const run = vi.fn(() => new Promise<void>((r) => { release = r }))
    const t = scheduleJob({ name: 'x', everyMs: 1000, run })
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(run).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2)
    clearInterval(t)
  })
  it('waits one interval when startNow is false', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => 0)
    const t = scheduleJob({ name: 'x', everyMs: 1000, run, startNow: false })
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(1)
    clearInterval(t)
  })
  it('keeps ticking after a failure', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => { throw new Error('boom') })
    const t = scheduleJob({ name: 'x', everyMs: 1000, run })
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2)
    clearInterval(t)
  })
})
