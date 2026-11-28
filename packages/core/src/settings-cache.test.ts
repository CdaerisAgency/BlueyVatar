import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsCache } from './settings-cache.js'
import { DEFAULT_SETTINGS, type SettingRow } from './settings.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('SettingsCache', () => {
  it('serves defaults before start', () => {
    const cache = new SettingsCache(async () => [{ key: 'limits.anonymousDaily', value: 500 }])
    expect(cache.current()).toEqual(DEFAULT_SETTINGS)
  })

  it('the refresh timer is unref()ed so it never holds the process open', async () => {
    const unref = vi.fn()
    const real = globalThis.setInterval
    const spy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => {
      const handle = real(fn, ms)
      const origUnref = handle.unref.bind(handle)
      handle.unref = () => { unref(); return origUnref() }
      return handle
    }) as typeof setInterval)
    const cache = new SettingsCache(async () => [])
    try {
      await cache.start()
      expect(unref).toHaveBeenCalledTimes(1)
    } finally {
      cache.stop()
      spy.mockRestore()
    }
  })

  it('start loads rows', async () => {
    const cache = new SettingsCache(async () => [{ key: 'limits.anonymousDaily', value: 500 }])
    await cache.start()
    expect(cache.current().anonymousDaily).toBe(500)
    cache.stop()
  })

  it('refresh applies a change', async () => {
    let rows: SettingRow[] = [{ key: 'limits.anonymousDaily', value: 500 }]
    const cache = new SettingsCache(async () => rows)
    await cache.start()
    rows = [{ key: 'limits.anonymousDaily', value: 700 }]
    await cache.refresh()
    expect(cache.current().anonymousDaily).toBe(700)
    cache.stop()
  })

  it('failed refresh keeps the last snapshot and calls onError', async () => {
    let fail = false
    const onError = vi.fn()
    const cache = new SettingsCache(
      async () => {
        if (fail) throw new Error('db down')
        return [{ key: 'limits.anonymousDaily', value: 500 }]
      },
      { onError },
    )
    await cache.start()
    fail = true
    await cache.refresh()
    expect(cache.current().anonymousDaily).toBe(500)
    expect(onError).toHaveBeenCalledTimes(1)
    cache.stop()
  })

  it('start resolves when the first load fails and keeps defaults', async () => {
    const onError = vi.fn()
    const cache = new SettingsCache(async () => { throw new Error('db down') }, { onError })
    await cache.start()
    expect(cache.current()).toEqual(DEFAULT_SETTINGS)
    expect(onError).toHaveBeenCalledTimes(1)
    cache.stop()
  })

  it('null loader serves defaults', async () => {
    const cache = new SettingsCache(null)
    await cache.start()
    await cache.refresh()
    expect(cache.current()).toEqual(DEFAULT_SETTINGS)
    cache.stop()
  })

  it('stop clears the timer', async () => {
    vi.useFakeTimers()
    const load = vi.fn(async (): Promise<SettingRow[]> => [])
    const cache = new SettingsCache(load, { refreshMs: 1000 })
    await cache.start()
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(load).toHaveBeenCalledTimes(4)
    cache.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(load).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not run refresh concurrently', async () => {
    let release!: () => void
    let calls = 0
    const load = vi.fn(() => {
      calls++
      return calls === 1 ? new Promise<SettingRow[]>((res) => { release = () => res([]) }) : Promise.resolve([] as SettingRow[])
    })
    const cache = new SettingsCache(load)
    const a = cache.refresh()
    const b = cache.refresh()
    expect(load).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([a, b])
    await cache.refresh()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('rejected keys reach onRejected', async () => {
    const onRejected = vi.fn()
    const cache = new SettingsCache(
      async () => [{ key: 'limits.anonymousDaily', value: 1 }, { key: 'nope', value: 1 }],
      { onRejected },
    )
    await cache.start()
    expect(onRejected).toHaveBeenCalledWith(['limits.anonymousDaily', 'nope'])
    expect(cache.current().anonymousDaily).toBe(DEFAULT_SETTINGS.anonymousDaily)
    cache.stop()
  })

  it('snapshots are immutable and defaults stay intact', async () => {
    const before = structuredClone(DEFAULT_SETTINGS)
    const cache = new SettingsCache(async () => [{ key: 'sizes.free.maxSize', value: 256 }])
    expect(() => { cache.current().maxSize.free = 9999 }).toThrow(TypeError)
    expect(DEFAULT_SETTINGS).toEqual(before)
    await cache.start()
    expect(() => { cache.current().maxSize.free = 9999 }).toThrow(TypeError)
    expect(cache.current().maxSize.free).toBe(256)
    expect(DEFAULT_SETTINGS).toEqual(before)
    cache.stop()
  })

  it('a throwing onError or onRejected cannot reject refresh', async () => {
    const bad = new SettingsCache(async () => { throw new Error('x') }, { onError: () => { throw new Error('cb') } })
    await expect(bad.refresh()).resolves.toBeUndefined()
    const bad2 = new SettingsCache(async () => [{ key: 'nope', value: 1 }], { onRejected: () => { throw new Error('cb') } })
    await expect(bad2.refresh()).resolves.toBeUndefined()
  })

  it('double start() keeps one timer', async () => {
    vi.useFakeTimers()
    const cache = new SettingsCache(async () => [], { refreshMs: 1000 })
    await cache.start()
    await cache.start()
    expect(vi.getTimerCount()).toBe(1)
    cache.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refreshes every 60000 ms by default', async () => {
    vi.useFakeTimers()
    const load = vi.fn(async (): Promise<SettingRow[]> => [])
    const cache = new SettingsCache(load)
    await cache.start()
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(2)
    cache.stop()
  })
})
