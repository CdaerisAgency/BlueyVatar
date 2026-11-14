import { describe, expect, it, vi } from 'vitest'
import type { StoredImage } from '../repo'
import type { Plan } from '../records'
import { canUse, parseFrame } from './catalog'
import { applyFrame, removeFrame, scheduleAway, tickAway, turnOffAway, type FlowDeps } from './flow'
import { memoryEffectsStore } from './store'

const DID = 'did:plc:alice'
const img = (rkey: string, extra: Partial<StoredImage['value']> = {}): StoredImage => ({
  uri: `at://${DID}/com.blueyvatar.image/${rkey}`, cid: `cid-${rkey}`, rkey,
  value: { image: { $type: 'blob', ref: { $link: `blob-${rkey}` }, mimeType: 'image/png', size: 1 }, createdAt: '2026-01-01T00:00:00Z', ...extra },
})

function setup(opts: { plan?: Plan; images?: StoredImage[]; now?: Date; screenOk?: boolean } = {}) {
  const images = opts.images ?? [img('orig', { isDefault: true, alt: 'Me', labels: { values: [{ val: 'sexual' }] } })]
  let now = opts.now ?? new Date('2026-11-14T12:00:00Z')
  let n = 0
  const store = memoryEffectsStore()
  const calls: string[] = []
  const deps: FlowDeps = {
    store,
    repo: {
      list: async () => images.map((i) => ({ ...i, value: { ...i.value } })),
      blob: async (i) => ({ ok: true, value: new TextEncoder().encode(i.rkey) }),
      async add(bytes, _mime, meta, makeDefault) {
        const rkey = `new${++n}`
        calls.push(`add:${rkey}:${meta.alt ?? ''}:${meta.labels ? 'labels' : 'nolabels'}`)
        if (makeDefault) for (const i of images) i.value.isDefault = false
        images.push(img(rkey, { isDefault: makeDefault, ...(meta.alt ? { alt: meta.alt } : {}) }))
        return rkey
      },
      async remove(rkey) {
        calls.push(`remove:${rkey}`)
        images.splice(images.findIndex((i) => i.rkey === rkey), 1)
      },
      async setDefault(t) {
        calls.push(`default:${t.rkey}`)
        for (const i of images) i.value.isDefault = i.rkey === t.rkey
      },
    },
    plan: async () => opts.plan ?? 'plus',
    render: vi.fn(async (input) => ({ ok: true as const, value: { bytes: input.bytes, mime: 'image/png' as const } })),
    prepare: vi.fn(async (bytes) => ({ ok: true as const, value: { bytes, mime: 'image/png' as const } })),
    screen: vi.fn(async () => (opts.screenOk === false ? { ok: false as const, error: 'blocked' } : { ok: true as const })),
    push: async () => null,
    now: () => now,
  }
  return { deps, images, store, calls, setNow: (d: Date) => (now = d) }
}

describe('catalog', () => {
  it('makes frames Plus and the away badge free, with room for grants', () => {
    expect(canUse('badge:away', 'free')).toBe(true)
    expect(canUse('frame:ring', 'free')).toBe(false)
    expect(canUse('frame:ring', 'plus')).toBe(true)
    expect(canUse('frame:dashed', 'free', ['frame:dashed'])).toBe(true)
  })
  it('rejects unknown styles and colors', () => {
    expect(parseFrame('ring', 'blue').ok).toBe(true)
    expect(parseFrame('glow', 'blue').ok).toBe(false)
    expect(parseFrame('ring', '#ff0000').ok).toBe(false)
  })
})

describe('frame', () => {
  it('renders from the original, screens it, saves it as the default, and copies alt and labels', async () => {
    const s = setup()
    const r = await applyFrame(s.deps, DID, { sourceRkey: 'orig', style: 'ring', color: 'blue' })
    expect(r.ok).toBe(true)
    expect(s.deps.screen).toHaveBeenCalledTimes(1)
    expect(s.calls).toEqual(['add:new1:Me:labels'])
    expect(s.images.find((i) => i.rkey === 'new1')?.value.isDefault).toBe(true)
    expect(await s.store.get(DID)).toMatchObject({ frameStyle: 'ring', frameColor: 'blue', frameSourceRkey: 'orig', frameImageRkey: 'new1' })
  })
  it('is Plus only', async () => {
    const s = setup({ plan: 'free' })
    expect(await applyFrame(s.deps, DID, { sourceRkey: 'orig', style: 'ring', color: 'blue' })).toMatchObject({ ok: false })
    expect(s.calls).toEqual([])
  })
  it('writes nothing when screening blocks the render', async () => {
    const s = setup({ screenOk: false })
    expect(await applyFrame(s.deps, DID, { sourceRkey: 'orig', style: 'ring', color: 'blue' })).toEqual({ ok: false, error: 'blocked' })
    expect(s.calls).toEqual([])
    expect((await s.store.get(DID)).frameImageRkey).toBeNull()
  })
  it('replaces the earlier render and never renders from a render', async () => {
    const s = setup()
    await applyFrame(s.deps, DID, { sourceRkey: 'orig', style: 'ring', color: 'blue' })
    expect(await applyFrame(s.deps, DID, { sourceRkey: 'new1', style: 'ring', color: 'blue' })).toMatchObject({ ok: false })
    const r = await applyFrame(s.deps, DID, { sourceRkey: 'orig', style: 'dashed', color: 'green' })
    expect(r.ok).toBe(true)
    expect(s.calls).toContain('remove:new1')
    expect(s.images.map((i) => i.rkey)).toEqual(['orig', 'new2'])
  })
  it('respects the image limit', async () => {
    const full = Array.from({ length: 20 }, (_, i) => img(`i${i}`, i === 0 ? { isDefault: true } : {}))
    const s = setup({ images: full })
    expect(await applyFrame(s.deps, DID, { sourceRkey: 'i0', style: 'ring', color: 'blue' })).toMatchObject({ ok: false })
  })
  it('removing the frame puts the original back as default', async () => {
    const s = setup()
    await applyFrame(s.deps, DID, { sourceRkey: 'orig', style: 'ring', color: 'blue' })
    expect((await removeFrame(s.deps, DID)).ok).toBe(true)
    expect(s.images.map((i) => [i.rkey, i.value.isDefault])).toEqual([['orig', true]])
  })
})

describe('out-of-office', () => {
  const window = { start: '2026-11-15', end: '2026-11-17', timezone: 'UTC' }
  it('is free, and waits for the start', async () => {
    const s = setup({ plan: 'free' })
    expect((await scheduleAway(s.deps, DID, window)).ok).toBe(true)
    expect(await tickAway(s.deps, DID)).toBe('none')
    expect(s.calls).toEqual([])
  })
  it('switches on at the start with the away version as default, then restores the previous default at the end', async () => {
    const s = setup({ plan: 'free' })
    await scheduleAway(s.deps, DID, window)
    s.setNow(new Date('2026-11-15T00:00:30Z'))
    expect(await tickAway(s.deps, DID)).toBe('on')
    expect(s.images.find((i) => i.value.isDefault)?.rkey).toBe('new1')
    expect(s.deps.render).toHaveBeenCalledWith(expect.objectContaining({ look: { badge: 'away' } }))
    expect(await tickAway(s.deps, DID)).toBe('none') // repeat does nothing
    s.setNow(new Date('2026-11-17T23:59:00Z'))
    expect(await tickAway(s.deps, DID)).toBe('none')
    s.setNow(new Date('2026-11-18T00:00:01Z'))
    expect(await tickAway(s.deps, DID)).toBe('off')
    expect(s.images.map((i) => [i.rkey, i.value.isDefault])).toEqual([['orig', true]])
    expect((await s.store.get(DID)).awayState).toBe('off')
  })
  it('turning it off early restores the previous default too', async () => {
    const s = setup({ plan: 'free' })
    await scheduleAway(s.deps, DID, window)
    s.setNow(new Date('2026-11-16T00:00:00Z'))
    await tickAway(s.deps, DID)
    expect((await turnOffAway(s.deps, DID)).ok).toBe(true)
    expect(s.images.map((i) => [i.rkey, i.value.isDefault])).toEqual([['orig', true]])
  })
  it('cancelling a window that has not started writes nothing', async () => {
    const s = setup()
    await scheduleAway(s.deps, DID, window)
    await turnOffAway(s.deps, DID)
    expect(s.calls).toEqual([])
    expect((await s.store.get(DID)).awayState).toBe('off')
  })
  it('keeps a default the user chose meanwhile', async () => {
    const s = setup({ images: [img('orig', { isDefault: true }), img('other')] })
    await scheduleAway(s.deps, DID, window)
    s.setNow(new Date('2026-11-16T00:00:00Z'))
    await tickAway(s.deps, DID)
    await s.deps.repo.setDefault(img('other'))
    await turnOffAway(s.deps, DID)
    expect(s.images.find((i) => i.value.isDefault)?.rkey).toBe('other')
    expect(s.images.some((i) => i.rkey === 'new1')).toBe(false)
  })
  it('rebuilds a framed default from its original so the frame is drawn once', async () => {
    const s = setup()
    await applyFrame(s.deps, DID, { sourceRkey: 'orig', style: 'ring', color: 'blue' })
    await scheduleAway(s.deps, DID, window)
    s.setNow(new Date('2026-11-16T00:00:00Z'))
    await tickAway(s.deps, DID)
    expect(s.deps.render).toHaveBeenLastCalledWith(expect.objectContaining({ look: { badge: 'away', frame: { style: 'ring', color: 'blue' } } }))
    await turnOffAway(s.deps, DID)
    expect(s.images.find((i) => i.value.isDefault)?.rkey).toBe('new1') // the framed image is back
    expect((await applyFrame(s.deps, DID, { sourceRkey: 'orig', style: 'ring', color: 'blue' })).ok).toBe(true)
  })
  it('blocks frame changes while it is on', async () => {
    const s = setup()
    await scheduleAway(s.deps, DID, window)
    s.setNow(new Date('2026-11-16T00:00:00Z'))
    await tickAway(s.deps, DID)
    expect(await applyFrame(s.deps, DID, { sourceRkey: 'orig', style: 'ring', color: 'blue' })).toMatchObject({ ok: false })
    expect(await removeFrame(s.deps, DID)).toMatchObject({ ok: false })
  })
  it('marks a failed switch-on, with the screening reason, and leaves the default alone', async () => {
    const s = setup({ screenOk: false })
    await scheduleAway(s.deps, DID, window)
    s.setNow(new Date('2026-11-16T00:00:00Z'))
    expect(await tickAway(s.deps, DID)).toBe('failed')
    expect(await s.store.get(DID)).toMatchObject({ awayState: 'failed', awayError: 'blocked' })
    expect(s.images.find((i) => i.value.isDefault)?.rkey).toBe('orig')
  })
  it('retries a failed switch-off later instead of leaving the badge up', async () => {
    const s = setup()
    await scheduleAway(s.deps, DID, window)
    s.setNow(new Date('2026-11-16T00:00:00Z'))
    await tickAway(s.deps, DID)
    const real = s.deps.repo.setDefault
    s.deps.repo.setDefault = async () => { throw new Error('pds down') }
    s.setNow(new Date('2026-11-18T00:00:01Z'))
    expect(await tickAway(s.deps, DID)).toBe('failed')
    expect((await s.store.get(DID)).awayState).toBe('active')
    expect(await tickAway(s.deps, DID)).toBe('none') // waits
    s.deps.repo.setDefault = real
    s.setNow(new Date('2026-11-18T00:20:00Z'))
    expect(await tickAway(s.deps, DID)).toBe('off')
  })
  it('drops a window that ended before it could start', async () => {
    const s = setup()
    await scheduleAway(s.deps, DID, window)
    s.setNow(new Date('2026-11-20T00:00:00Z'))
    expect(await tickAway(s.deps, DID)).toBe('none')
    expect((await s.store.get(DID)).awayState).toBe('off')
    expect(s.calls).toEqual([])
  })
  it('rejects bad dates', async () => {
    const s = setup()
    expect(await scheduleAway(s.deps, DID, { start: '2026-11-17', end: '2026-11-15', timezone: 'UTC' })).toMatchObject({ ok: false })
  })
})
