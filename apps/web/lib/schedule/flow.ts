import { activeEntry, holidayLookup, isValidTimeZone, localDate, nextChange, parseSchedule, type HolidayLookup, type OccurrenceSource, type Schedule, type Weekday } from '@blueyvatar/core'
import type { StoredImage } from '../repo'
import type { Plan } from '../records'
import type { EffectsRow } from '../effects/store'
import type { RepoPort, Result } from '../effects/flow'
import type { ScheduleRow, ScheduleStore } from './store'

/**
 * The avatar calendar (issue #219), written against small ports so tests run without a repository or a database.
 * The settings live in our database. The switch changes the user's default image through the same record writes as
 * every other default change, and a saved frame or filter look is kept by reusing the effects flow (applyFrame).
 */
export interface ScheduleDeps {
  store: ScheduleStore
  /** The effects row, read only. */
  effects(): Promise<EffectsRow>
  repo: Pick<RepoPort, 'list' | 'setDefault'>
  plan(): Promise<Plan>
  /** Renders the saved look from this original and makes the render the default (applyFrame; it pushes by itself). */
  applyLook(sourceRkey: string, effects: EffectsRow): Promise<Result>
  /** Pushes the new default to apps the user turned on. */
  push(): Promise<string | null>
  now(): Date
  /** Holiday data for the account's country (issue #220). Left out, no holiday applies. */
  holidays?: HolidayData
}

/** What the holiday feature needs from the holiday library, so tests can use a small fake. */
export interface HolidayData {
  hasCountry(country: string): boolean
  hasRegion(country: string, region: string): boolean
  occurrences(country: string, region: string): OccurrenceSource
}

const fail = (error: string): Result => ({ ok: false, error })
const done = (message: string): Result => ({ ok: true, message })

export const RETRY_MS = 15 * 60_000
export const LEASE_MS = 5 * 60_000

export const PLUS_ONLY = 'The avatar calendar is part of the Plus plan.'

/** Renders (ours) are never scheduled; only original images are. */
const isRender = (e: EffectsRow, rkey: string) => rkey === e.frameImageRkey || rkey === e.awayImageRkey

const isDefault = (i: StoredImage) => i.value.isDefault === true

export async function originals(deps: ScheduleDeps): Promise<{ images: StoredImage[]; ok: Set<string> }> {
  const [images, effects] = await Promise.all([deps.repo.list(), deps.effects()])
  return { images, ok: new Set(images.filter((i) => !isRender(effects, i.rkey)).map((i) => i.rkey)) }
}

export async function requirePlus(deps: ScheduleDeps): Promise<Result | null> {
  return (await deps.plan()) === 'plus' ? null : fail(PLUS_ONLY)
}

/** Save the time zone. Needed before any entry. A new zone makes the switch re-check at once. */
export async function saveTimezone(deps: ScheduleDeps, did: string, timezone: string): Promise<Result> {
  const gate = await requirePlus(deps)
  if (gate) return gate
  const tz = timezone.trim()
  if (!isValidTimeZone(tz)) return fail('Enter a time zone such as America/New_York or UTC.')
  await deps.store.patch(did, { timezone: tz, nextChangeAt: deps.now() })
  return done('Time zone saved.')
}

async function save(deps: ScheduleDeps, did: string, row: ScheduleRow, schedule: Schedule): Promise<void> {
  await deps.store.patch(did, { schedule: parseSchedule(schedule), nextChangeAt: deps.now(), timezone: row.timezone })
}

/** Add or replace the image for one local date. Today or later, an original image of the account. */
export async function setDateEntry(deps: ScheduleDeps, did: string, input: { date: string; image: string }): Promise<Result> {
  const gate = await requirePlus(deps)
  if (gate) return gate
  const row = await deps.store.get(did)
  if (!row || !isValidTimeZone(row.timezone)) return fail('Choose your time zone first.')
  const parsed = parseSchedule({ dates: [{ date: input.date, image: input.image }] })
  if (parsed.dates.length === 0) return fail('Choose a valid date and one of your images.')
  if (input.date < localDate(deps.now(), row.timezone)) return fail('Choose today or a later date.')
  const { ok } = await originals(deps)
  if (!ok.has(input.image)) return fail('Choose one of your original images.')
  const dates = row.schedule.dates.filter((d) => d.date !== input.date).concat(parsed.dates)
  await save(deps, did, row, { dates, weekly: row.schedule.weekly })
  return done('Day saved.')
}

export async function removeDateEntry(deps: ScheduleDeps, did: string, date: string): Promise<Result> {
  const row = await deps.store.get(did)
  if (!row) return done('That day was already removed.')
  await save(deps, did, row, { dates: row.schedule.dates.filter((d) => d.date !== date), weekly: row.schedule.weekly })
  return done('Day removed.')
}

/** Replace the weekly entries. `images[weekday]` is an image rkey, or empty for "use my default". Weekday 0 is Sunday. */
export async function setWeekly(deps: ScheduleDeps, did: string, images: Record<number, string>): Promise<Result> {
  const gate = await requirePlus(deps)
  if (gate) return gate
  const row = await deps.store.get(did)
  if (!row || !isValidTimeZone(row.timezone)) return fail('Choose your time zone first.')
  const { ok } = await originals(deps)
  const weekly: { weekday: Weekday; image: string }[] = []
  for (let w = 0; w < 7; w++) {
    const image = images[w]
    if (!image) continue
    if (!ok.has(image)) return fail('Choose one of your original images.')
    weekly.push({ weekday: w as Weekday, image })
  }
  await save(deps, did, row, { dates: row.schedule.dates, weekly })
  return done('Weekly days saved.')
}

/**
 * Remove a deleted image from the calendar. If it was the image in force, the next tick restores the user's own
 * default. Safe to call for an account with no calendar.
 */
export async function stripImage(store: ScheduleStore, did: string, rkey: string, now: Date = new Date()): Promise<void> {
  const row = await store.get(did)
  if (!row) return
  const dates = row.schedule.dates.filter((d) => d.image !== rkey)
  const weekly = row.schedule.weekly.filter((w) => w.image !== rkey)
  const picks = row.holidays.picks.filter((p) => p.image !== rkey)
  const changed = dates.length !== row.schedule.dates.length || weekly.length !== row.schedule.weekly.length || picks.length !== row.holidays.picks.length
  if (!changed && row.appliedImage !== rkey && row.appliedDefault !== rkey) return
  await store.patch(did, { schedule: { dates, weekly }, holidays: { ...row.holidays, picks }, nextChangeAt: now })
}

/** The next time the switch needs to look, or null when no change is coming. */
function nextTime(row: ScheduleRow, schedule: Schedule, now: Date, holiday?: HolidayLookup): Date | null {
  return nextChange(schedule, row.timezone, now, { holiday })
}

/** The holiday hook for a row, or undefined when it has no country, no picks, or no holiday data. */
export function holidayHook(deps: Pick<ScheduleDeps, 'holidays'>, row: ScheduleRow): HolidayLookup | undefined {
  const h = row.holidays
  if (!deps.holidays || !h.country || h.picks.length === 0) return undefined
  return holidayLookup(h, deps.holidays.occurrences(h.country, h.region))
}

type Outcome = 'applied' | 'restored' | 'waiting' | 'none' | 'failed'

async function apply(deps: ScheduleDeps, row: ScheduleRow, effects: EffectsRow, images: StoredImage[], desired: string): Promise<Pick<ScheduleRow, 'appliedDefault' | 'prevDefault' | 'prevLookSource'>> {
  const current = images.find(isDefault)
  const lookInForce = !!effects.frameImageRkey && current?.rkey === effects.frameImageRkey
  const fresh = row.appliedImage === null
  const prev = fresh
    ? { prevDefault: current?.rkey ?? null, prevLookSource: lookInForce ? effects.frameSourceRkey : null }
    : { prevDefault: row.prevDefault, prevLookSource: row.prevLookSource }
  if (lookInForce) {
    const r = await deps.applyLook(desired, effects)
    if (!r.ok) throw new Error(r.error)
  } else if (current?.rkey !== desired) {
    const target = images.find((i) => i.rkey === desired)!
    await deps.repo.setDefault(target)
    await deps.push()
  }
  const now = (await deps.repo.list()).find(isDefault)
  return { appliedDefault: now?.rkey ?? desired, ...prev }
}

/** Bring back what the user had before the calendar took over. The user's own later choice stands. */
async function restore(deps: ScheduleDeps, row: ScheduleRow, effects: EffectsRow, images: StoredImage[], renders: Set<string>): Promise<void> {
  const current = images.find(isDefault)
  if (!row.appliedDefault || current?.rkey !== row.appliedDefault) return
  const find = (rkey: string | null) => (rkey ? images.find((i) => i.rkey === rkey) : undefined)
  if (row.prevLookSource && effects.frameImageRkey) {
    const r = await deps.applyLook(row.prevLookSource, effects)
    if (r.ok) return
    const src = find(row.prevLookSource)
    if (src) {
      await deps.repo.setDefault(src)
      await deps.push()
    }
    return
  }
  const back = find(row.prevDefault) ?? images.find((i) => i.rkey !== row.appliedImage && !renders.has(i.rkey))
  if (back && back.rkey !== current.rkey) {
    await deps.repo.setDefault(back)
    await deps.push()
  }
}

/**
 * One step for an account, called by the indexer job through the tick route. It re-reads the row, claims it with a
 * short lease so overlapping calls cannot both act, and does only what is due now: a repeat does nothing.
 * - Out-of-office on: waits until it ends.
 * - An entry applies: its image becomes the default (through the saved look when there is one).
 * - No entry applies, or Plus has lapsed: the default from before the calendar comes back.
 * A failure is recorded for the page and retried in 15 minutes.
 */
export async function tickSchedule(deps: ScheduleDeps, did: string): Promise<Outcome> {
  const now = deps.now()
  const row = await deps.store.get(did)
  if (!row || !row.nextChangeAt || row.nextChangeAt > now) return 'none'
  if (!(await deps.store.lease(did, now, new Date(now.getTime() + LEASE_MS)))) return 'none'
  try {
    const effects = await deps.effects()
    if (effects.awayState === 'active') {
      const end = effects.awayEndAt && effects.awayEndAt > now ? effects.awayEndAt : now
      await deps.store.patch(did, { nextChangeAt: new Date(end.getTime() + 2 * 60_000) })
      return 'waiting'
    }
    const plus = (await deps.plan()) === 'plus'
    const schedule = parseSchedule(row.schedule)
    const images = await deps.repo.list()
    const renders = new Set(images.filter((i) => isRender(effects, i.rkey)).map((i) => i.rkey))
    const holiday = plus ? holidayHook(deps, row) : undefined
    const entry = plus ? activeEntry(schedule, row.timezone, now, { holiday }) : null
    const desired = entry && images.some((i) => i.rkey === entry.image && !renders.has(i.rkey)) ? entry.image : null
    const next = plus ? nextTime(row, schedule, now, holiday) : null
    if (desired === row.appliedImage) {
      await deps.store.patch(did, { nextChangeAt: next, ...(row.state === 'failed' ? { state: row.appliedImage ? 'applied' : 'idle', lastError: null } : {}) })
      return 'none'
    }
    if (desired) {
      const applied = await apply(deps, row, effects, images, desired)
      await deps.store.patch(did, { ...applied, appliedImage: desired, state: 'applied', lastError: null, nextChangeAt: next })
      return 'applied'
    }
    await restore(deps, row, effects, images, renders)
    await deps.store.patch(did, { appliedImage: null, appliedDefault: null, prevDefault: null, prevLookSource: null, state: 'idle', lastError: null, nextChangeAt: next })
    return 'restored'
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : 'The calendar could not change your default image.'
    await deps.store.patch(did, { state: 'failed', lastError: message.slice(0, 300), nextChangeAt: new Date(now.getTime() + RETRY_MS) })
    return 'failed'
  }
}
