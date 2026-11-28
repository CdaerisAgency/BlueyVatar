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
})
