import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A tiny hook runner, so useViewer runs without a DOM or a renderer: useState keeps a value, useEffect is run by hand.
let state: unknown
let effect: (() => void | (() => void)) | undefined
vi.mock('react', () => ({
  useState: (init: unknown) => {
    state ??= init
    return [state, (v: unknown) => (state = v)]
  },
  useEffect: (fn: () => void | (() => void)) => {
    effect = fn
  },
}))

import { useViewer } from '../components/useViewer'

const signedIn = { signedIn: true, name: 'ann.bsky.social', initial: 'A' }
const signedOut = { signedIn: false }
const flush = () => new Promise((r) => setTimeout(r, 0))

/** A window with only what useViewer uses: addEventListener and removeEventListener. */
function fakeWindow() {
  const target = new EventTarget()
  return Object.assign(target, {
    show: (persisted: boolean) => target.dispatchEvent(Object.assign(new Event('pageshow'), { persisted })),
    count: 0,
  })
}

describe('useViewer on pageshow', () => {
  const fetchMock = vi.fn()
  let win: ReturnType<typeof fakeWindow>
  let cleanup: void | (() => void)

  beforeEach(async () => {
    state = undefined
    effect = undefined
    fetchMock.mockReset().mockImplementation(async () => ({ ok: true, json: async () => signedIn }))
    vi.stubGlobal('fetch', fetchMock)
    win = fakeWindow()
    vi.stubGlobal('window', win)
    useViewer()
    cleanup = effect!()
    await flush()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the viewer once on mount', () => {
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state).toEqual(signedIn)
  })

  it('refetches and shows signed out when a page comes back from the Back/forward cache', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => signedOut }))
    win.show(true)
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/viewer')
    expect(state).toEqual(signedOut)
  })

  it('does not refetch on a normal pageshow', async () => {
    win.show(false)
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('removes the listener on unmount', async () => {
    if (typeof cleanup === 'function') cleanup()
    win.show(true)
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
