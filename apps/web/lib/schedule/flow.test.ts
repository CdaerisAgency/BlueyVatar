import { describe, expect, it, vi } from 'vitest'
import type { StoredImage } from '../repo'
import type { Plan } from '../records'
import { emptyRow, type EffectsRow } from '../effects/store'
import { removeDateEntry, saveTimezone, setDateEntry, setWeekly, stripImage, tickSchedule, RETRY_MS, type ScheduleDeps } from './flow'
import { memoryScheduleStore, pgScheduleStore } from './store'

const DID = 'did:plc:alice'
const img = (rkey: string, isDefault = false): StoredImage => ({
  uri: `at://${DID}/com.blueyvatar.image/${rkey}`, cid: `cid-${rkey}`, rkey,
  value: { image: { $type: 'blob', ref: { $link: `blob-${rkey}` }, mimeType: 'image/png', size: 1 }, createdAt: '2026-01-01T00:00:00Z', isDefault },
})

function setup(opts: { plan?: Plan; images?: StoredImage[]; effects?: Partial<EffectsRow>; now?: Date } = {}) {
  const images = opts.images ?? [img('home', true), img('a'), img('b')]
  let now = opts.now ?? new Date('2026-11-14T12:00:00Z')
  const store = memoryScheduleStore()
  const calls: string[] = []
  let effects: EffectsRow = { ...emptyRow(DID), ...opts.effects }
  const deps: ScheduleDeps = {
    store,
    effects: async () => effects,
    repo: {
      list: async () => images.map((i) => ({ ...i, value: { ...i.value } })),
      async setDefault(t) {
        calls.push(`default:${t.rkey}`)
        for (const i of images) i.value.isDefault = i.rkey === t.rkey
      },
    },
    plan: async () => opts.plan ?? 'plus',
    applyLook: vi.fn(async (source) => {
      calls.push(`look:${source}`)
      const rkey = `render-${source}`
      for (const i of images) i.value.isDefault = false
      images.push(img(rkey, true))
      effects = { ...effects, frameImageRkey: rkey, frameSourceRkey: source }
      return { ok: true as const, message: 'ok' }
    }),
    push: async () => {
      calls.push('push')
      return null
    },
    now: () => now,
  }
  return { deps, store, images, calls, setNow: (d: Date) => (now = d), setEffects: (e: Partial<EffectsRow>) => (effects = { ...effects, ...e }) }
}

async function withDay(s: ReturnType<typeof setup>, date: string, image: string) {
  expect((await saveTimezone(s.deps, DID, 'UTC')).ok).toBe(true)
  expect((await setDateEntry(s.deps, DID, { date, image })).ok).toBe(true)
}

describe('schedule store', () => {
  it('round-trips, drops bad entries on read, and leases a due row once', async () => {
    const store = memoryScheduleStore()
    const now = new Date('2026-11-14T12:00:00Z')
    await store.patch(DID, { timezone: 'UTC', schedule: { dates: [{ date: '2026-13-45', image: 'x' }, { date: '2026-12-25', image: 'a' }], weekly: [] }, nextChangeAt: now })
    expect((await store.get(DID))!.schedule.dates).toEqual([{ date: '2026-12-25', image: 'a' }])
    expect(await store.lease(DID, now, new Date(now.getTime() + 1000))).toBe(true)
    expect(await store.lease(DID, now, new Date(now.getTime() + 1000))).toBe(false)
    expect(await store.get('did:plc:none')).toBeNull()
  })
  it('the database store writes jsonb and a conditional lease', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }))
    const store = pgScheduleStore({ query } as never)
    expect(await store.lease(DID, new Date(), new Date())).toBe(true)
    await store.patch(DID, { schedule: { dates: [], weekly: [] }, timezone: 'UTC' }).catch(() => {})
    const sql = (query.mock.calls as unknown as [string, unknown[]][]).map((c) => c[0])
    expect(sql[0]).toContain('next_change_at <= $2')
    expect(sql[1]).toContain('$2::jsonb')
  })
})

describe('editing', () => {
  it('requires Plus and a time zone, and only today or later and original images', async () => {
    const free = setup({ plan: 'free' })
    expect((await saveTimezone(free.deps, DID, 'UTC')).ok).toBe(false)
    expect((await setDateEntry(free.deps, DID, { date: '2026-12-25', image: 'a' })).ok).toBe(false)
    expect(await free.store.get(DID)).toBeNull()
    const s = setup()
    expect((await setDateEntry(s.deps, DID, { date: '2026-12-25', image: 'a' })).ok).toBe(false)
    expect((await saveTimezone(s.deps, DID, 'Mars/Base')).ok).toBe(false)
    expect((await saveTimezone(s.deps, DID, 'UTC')).ok).toBe(true)
    expect((await setDateEntry(s.deps, DID, { date: '2026-11-13', image: 'a' })).ok).toBe(false)
    expect((await setDateEntry(s.deps, DID, { date: '2026-12-25', image: 'nope' })).ok).toBe(false)
    s.setEffects({ frameImageRkey: 'a' })
    expect((await setDateEntry(s.deps, DID, { date: '2026-12-25', image: 'a' })).ok).toBe(false)
    expect((await setDateEntry(s.deps, DID, { date: '2026-12-25', image: 'b' })).ok).toBe(true)
    expect((await removeDateEntry(s.deps, DID, '2026-12-25')).ok).toBe(true)
    expect((await s.store.get(DID))!.schedule.dates).toEqual([])
  })
  it('saves weekly entries', async () => {
    const s = setup()
    await saveTimezone(s.deps, DID, 'UTC')
    expect((await setWeekly(s.deps, DID, { 1: 'a', 0: 'b', 2: '' })).ok).toBe(true)
    expect((await s.store.get(DID))!.schedule.weekly).toEqual([{ weekday: 0, image: 'b' }, { weekday: 1, image: 'a' }])
    expect((await setWeekly(s.deps, DID, { 3: 'zzz' })).ok).toBe(false)
  })
})

describe('tick', () => {
  it('does nothing when not due or when there is no calendar', async () => {
    const s = setup()
    expect(await tickSchedule(s.deps, DID)).toBe('none')
    await withDay(s, '2026-11-20', 'a')
    await s.store.patch(DID, { nextChangeAt: new Date('2026-11-14T12:00:01Z') })
    expect(await tickSchedule(s.deps, DID)).toBe('none')
    expect(s.calls).toEqual([])
  })
  it('applies the entry as default and restores the previous default after it, and a repeat does nothing', async () => {
    const s = setup()
    await withDay(s, '2026-11-14', 'a')
    expect(await tickSchedule(s.deps, DID)).toBe('applied')
    expect(s.calls).toEqual(['default:a', 'push'])
    let row = (await s.store.get(DID))!
    expect(row).toMatchObject({ state: 'applied', appliedImage: 'a', prevDefault: 'home', appliedDefault: 'a' })
    expect(row.nextChangeAt!.toISOString()).toBe('2026-11-15T00:00:00.000Z')
    expect(await tickSchedule(s.deps, DID)).toBe('none')
    s.setNow(new Date('2026-11-15T00:00:30Z'))
    expect(await tickSchedule(s.deps, DID)).toBe('restored')
    expect(s.images.find((i) => i.value.isDefault)!.rkey).toBe('home')
    row = (await s.store.get(DID))!
    expect(row).toMatchObject({ state: 'idle', appliedImage: null, nextChangeAt: null })
  })
  it('keeps the user own default choice when they changed it meanwhile', async () => {
    const s = setup()
    await withDay(s, '2026-11-14', 'a')
    await tickSchedule(s.deps, DID)
    for (const i of s.images) i.value.isDefault = i.rkey === 'b'
    s.setNow(new Date('2026-11-15T00:00:30Z'))
    await tickSchedule(s.deps, DID)
    expect(s.images.find((i) => i.value.isDefault)!.rkey).toBe('b')
  })
  it('waits while out-of-office is on', async () => {
    const s = setup({ effects: { awayState: 'active', awayEndAt: new Date('2026-11-16T00:00:00Z') } })
    await withDay(s, '2026-11-14', 'a')
    expect(await tickSchedule(s.deps, DID)).toBe('waiting')
    expect(s.calls).toEqual([])
    expect((await s.store.get(DID))!.nextChangeAt!.toISOString()).toBe('2026-11-16T00:02:00.000Z')
  })
  it('keeps a saved look applied through the effects flow, and brings it back from the original', async () => {
    const s = setup({ images: [img('render-old', true), img('orig'), img('a')], effects: { frameStyle: 'ring', frameColor: 'blue', frameSourceRkey: 'orig', frameImageRkey: 'render-old' } })
    await withDay(s, '2026-11-14', 'a')
    expect(await tickSchedule(s.deps, DID)).toBe('applied')
    expect(s.calls).toEqual(['look:a'])
    expect((await s.store.get(DID))!).toMatchObject({ prevLookSource: 'orig', appliedDefault: 'render-a' })
    s.setNow(new Date('2026-11-15T00:00:30Z'))
    expect(await tickSchedule(s.deps, DID)).toBe('restored')
    expect(s.calls).toEqual(['look:a', 'look:orig'])
  })
  it('restores when Plus has lapsed', async () => {
    const s = setup()
    await withDay(s, '2026-11-14', 'a')
    await tickSchedule(s.deps, DID)
    s.deps.plan = async () => 'free'
    await s.store.patch(DID, { nextChangeAt: s.deps.now() })
    expect(await tickSchedule(s.deps, DID)).toBe('restored')
    expect(s.images.find((i) => i.value.isDefault)!.rkey).toBe('home')
  })
  it('records a failure and retries in 15 minutes', async () => {
    const s = setup()
    await withDay(s, '2026-11-14', 'a')
    s.deps.repo.setDefault = async () => {
      throw new Error('home server said no')
    }
    expect(await tickSchedule(s.deps, DID)).toBe('failed')
    const row = (await s.store.get(DID))!
    expect(row).toMatchObject({ state: 'failed', lastError: 'home server said no' })
    expect(row.nextChangeAt!.getTime()).toBe(s.deps.now().getTime() + RETRY_MS)
  })
})

describe('image delete cleanup', () => {
  it('strips the image from dates and weekly entries and asks for a re-check', async () => {
    const s = setup()
    await saveTimezone(s.deps, DID, 'UTC')
    await setDateEntry(s.deps, DID, { date: '2026-12-25', image: 'a' })
    await setDateEntry(s.deps, DID, { date: '2026-12-26', image: 'b' })
    await setWeekly(s.deps, DID, { 1: 'a', 2: 'b' })
    await s.store.patch(DID, { nextChangeAt: null })
    await stripImage(s.store, DID, 'a', new Date('2026-11-14T12:00:00Z'))
    const row = (await s.store.get(DID))!
    expect(row.schedule).toEqual({ dates: [{ date: '2026-12-26', image: 'b' }], weekly: [{ weekday: 2, image: 'b' }] })
    expect(row.nextChangeAt).not.toBeNull()
    await stripImage(s.store, 'did:plc:none', 'a')
  })
})
