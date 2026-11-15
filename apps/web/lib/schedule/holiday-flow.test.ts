import { describe, expect, it } from 'vitest'
import type { StoredImage } from '../repo'
import type { Plan } from '../records'
import { emptyRow } from '../effects/store'
import { liveHolidayData } from '../holidays/data'
import { saveTimezone, stripImage, tickSchedule, type ScheduleDeps } from './flow'
import { NO_DEFAULT, removeHolidayPick, setHolidayCountry, setHolidayPick } from './holiday-flow'
import { memoryScheduleStore } from './store'
import { DID, img as fixtureImg } from '../testing/fixtures'

const img = (rkey: string, isDefault = false) => fixtureImg(rkey, { isDefault })

function setup(opts: { plan?: Plan; images?: StoredImage[]; now?: Date } = {}) {
  const images = opts.images ?? [img('home', true), img('turkey'), img('flag')]
  let now = opts.now ?? new Date('2026-11-14T12:00:00Z')
  const store = memoryScheduleStore()
  const calls: string[] = []
  const deps: ScheduleDeps = {
    store,
    effects: async () => emptyRow(DID),
    repo: {
      list: async () => images.map((i) => ({ ...i, value: { ...i.value } })),
      async setDefault(t) {
        calls.push(`default:${t.rkey}`)
        for (const i of images) i.value.isDefault = i.rkey === t.rkey
      },
    },
    plan: async () => opts.plan ?? 'plus',
    applyLook: async () => ({ ok: true as const, message: 'ok' }),
    push: async () => null,
    now: () => now,
    holidays: liveHolidayData,
  }
  return { deps, store, images, calls, setNow: (d: Date) => (now = d) }
}

async function ready(s: ReturnType<typeof setup>, tz = 'UTC', country = 'US', region = '') {
  expect((await saveTimezone(s.deps, DID, tz)).ok).toBe(true)
  expect((await setHolidayCountry(s.deps, DID, { country, region })).ok).toBe(true)
}

describe('holiday editing', () => {
  it('is Plus only', async () => {
    const free = setup({ plan: 'free' })
    await free.store.patch(DID, { timezone: 'UTC' })
    expect((await setHolidayCountry(free.deps, DID, { country: 'US', region: '' })).ok).toBe(false)
    expect((await setHolidayPick(free.deps, DID, { id: 'thanksgiving-day', image: 'turkey', daysBefore: 0, daysAfter: 0 })).ok).toBe(false)
    expect((await free.store.get(DID))!.holidays).toEqual({ country: '', region: '', picks: [] })
  })
  it('needs a time zone, a real country, and a real region', async () => {
    const s = setup()
    expect((await setHolidayCountry(s.deps, DID, { country: 'US', region: '' })).ok).toBe(false)
    await saveTimezone(s.deps, DID, 'UTC')
    expect((await setHolidayCountry(s.deps, DID, { country: 'ZZ', region: '' })).ok).toBe(false)
    expect((await setHolidayCountry(s.deps, DID, { country: 'CA', region: '' })).ok).toBe(true)
    expect((await setHolidayCountry(s.deps, DID, { country: 'CA', region: 'XX' })).ok).toBe(false)
    expect((await setHolidayCountry(s.deps, DID, { country: 'CA', region: 'on' })).ok).toBe(true)
    expect((await s.store.get(DID))!.holidays).toMatchObject({ country: 'CA', region: 'ON' })
  })
  it('saves a pick, replaces it, validates the window, image and holiday', async () => {
    const s = setup()
    await ready(s)
    const pick = { id: 'thanksgiving-day', image: 'turkey', daysBefore: 2, daysAfter: 1 }
    expect((await setHolidayPick(s.deps, DID, pick)).ok).toBe(true)
    expect((await setHolidayPick(s.deps, DID, { ...pick, image: 'flag' })).ok).toBe(true)
    expect((await s.store.get(DID))!.holidays.picks).toEqual([{ ...pick, image: 'flag' }])
    expect((await setHolidayPick(s.deps, DID, { ...pick, daysBefore: 15 })).ok).toBe(false)
    expect((await setHolidayPick(s.deps, DID, { ...pick, daysAfter: -1 })).ok).toBe(false)
    expect((await setHolidayPick(s.deps, DID, { ...pick, daysAfter: Number.NaN })).ok).toBe(false)
    expect((await setHolidayPick(s.deps, DID, { ...pick, image: 'missing' })).ok).toBe(false)
    expect((await setHolidayPick(s.deps, DID, { ...pick, id: 'not-a-holiday' })).ok).toBe(false)
    expect((await s.store.get(DID))!.nextChangeAt).toEqual(s.deps.now())
  })
  it('refuses a pick while no default avatar exists', async () => {
    const s = setup({ images: [img('turkey'), img('flag')] })
    await ready(s)
    const r = await setHolidayPick(s.deps, DID, { id: 'thanksgiving-day', image: 'turkey', daysBefore: 0, daysAfter: 0 })
    expect(r).toEqual({ ok: false, error: NO_DEFAULT })
  })
  it('a new country clears the picks, a new region keeps them, and off clears everything', async () => {
    const s = setup()
    await ready(s)
    await setHolidayPick(s.deps, DID, { id: 'thanksgiving-day', image: 'turkey', daysBefore: 0, daysAfter: 0 })
    await setHolidayCountry(s.deps, DID, { country: 'US', region: 'CA' })
    expect((await s.store.get(DID))!.holidays.picks).toHaveLength(1)
    await setHolidayCountry(s.deps, DID, { country: 'CA', region: 'CA' })
    expect((await s.store.get(DID))!.holidays).toEqual({ country: 'CA', region: '', picks: [] })
    await setHolidayCountry(s.deps, DID, { country: '', region: '' })
    expect((await s.store.get(DID))!.holidays.country).toBe('')
  })
  it('removes a pick, and a deleted image leaves the picks', async () => {
    const s = setup()
    await ready(s)
    await setHolidayPick(s.deps, DID, { id: 'thanksgiving-day', image: 'turkey', daysBefore: 0, daysAfter: 0 })
    await setHolidayPick(s.deps, DID, { id: 'christmas-day', image: 'flag', daysBefore: 0, daysAfter: 0 })
    await stripImage(s.store, DID, 'turkey', s.deps.now())
    expect((await s.store.get(DID))!.holidays.picks.map((p) => p.id)).toEqual(['christmas-day'])
    expect((await removeHolidayPick(s.deps, DID, 'christmas-day')).ok).toBe(true)
    expect((await s.store.get(DID))!.holidays.picks).toEqual([])
  })
})

describe('holidays in the switch', () => {
  it('US Thanksgiving 2026 (Nov 26) applies in the owner zone and the default comes back after', async () => {
    const s = setup({ now: new Date('2026-11-14T12:00:00Z') })
    await ready(s, 'America/Los_Angeles')
    await setHolidayPick(s.deps, DID, { id: 'thanksgiving-day', image: 'turkey', daysBefore: 0, daysAfter: 0 })
    // Nov 26 03:00Z is Nov 25 evening in Los Angeles: not yet.
    s.setNow(new Date('2026-11-26T03:00:00Z'))
    expect(await tickSchedule(s.deps, DID)).toBe('none')
    expect(s.calls).toEqual([])
    // The row names the start of Nov 26 in Los Angeles (08:00Z).
    const row = (await s.store.get(DID))!
    expect(row.nextChangeAt?.toISOString()).toBe('2026-11-26T08:00:00.000Z')
    s.setNow(new Date('2026-11-26T08:00:00Z'))
    expect(await tickSchedule(s.deps, DID)).toBe('applied')
    expect(s.calls).toContain('default:turkey')
    expect((await s.store.get(DID))!.nextChangeAt?.toISOString()).toBe('2026-11-27T08:00:00.000Z')
    s.setNow(new Date('2026-11-27T08:00:00Z'))
    expect(await tickSchedule(s.deps, DID)).toBe('restored')
    expect(s.calls).toContain('default:home')
  })
  it('Canada Victoria Day 2026 (May 18, Ontario) applies', async () => {
    const s = setup({ now: new Date('2026-05-01T12:00:00Z') })
    await ready(s, 'America/Toronto', 'CA', '')
    await setHolidayCountry(s.deps, DID, { country: 'CA', region: 'ON' })
    await setHolidayPick(s.deps, DID, { id: 'victoria-day', image: 'flag', daysBefore: 1, daysAfter: 0 })
    s.setNow(new Date('2026-05-17T05:00:00Z'))
    expect(await tickSchedule(s.deps, DID)).toBe('applied')
    expect(s.calls).toContain('default:flag')
  })
  it('a lapsed Plus plan ignores holidays', async () => {
    const s = setup({ now: new Date('2026-11-14T12:00:00Z') })
    await ready(s)
    await setHolidayPick(s.deps, DID, { id: 'thanksgiving-day', image: 'turkey', daysBefore: 0, daysAfter: 0 })
    s.setNow(new Date('2026-11-26T12:00:00Z'))
    ;(s.deps as { plan: () => Promise<Plan> }).plan = async () => 'free'
    await s.store.patch(DID, { nextChangeAt: s.deps.now() })
    expect(await tickSchedule(s.deps, DID)).toBe('none')
    expect(s.calls).toEqual([])
  })
})
