import { MAX_HOLIDAY_PICKS, MAX_WINDOW_DAYS, emptyHolidaySettings, isValidTimeZone, localDate, type HolidaySettings } from '@blueyvatar/core'
import type { Result } from '../effects/flow'
import { originals, requirePlus, type ScheduleDeps } from './flow'

/**
 * Editing the holiday avatars (issue #220). The settings sit in the calendar row (migration 0045) next to the date and
 * weekly entries, and the same tick applies them: precedence is date entry, holiday, weekly (packages/core/src/schedule.ts).
 */
const fail = (error: string): Result => ({ ok: false, error })
const done = (message: string): Result => ({ ok: true, message })

const NO_ZONE = 'Choose your time zone first.'
const NO_COUNTRY = 'Choose your country first.'
export const NO_DEFAULT = 'Set a default avatar first. It shows whenever no holiday is active.'

/** Choose the country (and region) whose holidays are listed. A new country clears the holiday picks. */
export async function setHolidayCountry(deps: ScheduleDeps, did: string, input: { country: string; region: string }): Promise<Result> {
  const gate = await requirePlus(deps)
  if (gate) return gate
  const row = await deps.store.get(did)
  if (!row || !isValidTimeZone(row.timezone)) return fail(NO_ZONE)
  const country = input.country.trim().toUpperCase()
  if (country === '') {
    await deps.store.patch(did, { holidays: emptyHolidaySettings(), nextChangeAt: deps.now() })
    return done('Holiday avatars are off. Your picks were removed.')
  }
  if (!deps.holidays?.hasCountry(country)) return fail('Choose a country from the list.')
  const same = row.holidays.country === country
  // The region list belongs to the saved country, so a new country starts with no region.
  const region = same ? input.region.trim().toUpperCase() : ''
  if (!deps.holidays.hasRegion(country, region)) return fail('Choose a region from the list.')
  const holidays: HolidaySettings = { country, region, picks: same ? row.holidays.picks : [] }
  await deps.store.patch(did, { holidays, nextChangeAt: deps.now() })
  return done(same ? 'Country saved.' : 'Country saved. Pick the holidays you want an avatar for.')
}

function windowDays(v: number): number | null {
  return Number.isInteger(v) && v >= 0 && v <= MAX_WINDOW_DAYS ? v : null
}

/** Choose an image for one holiday, and how many days before and after it shows. Replaces an earlier pick for it. */
export async function setHolidayPick(
  deps: ScheduleDeps,
  did: string,
  input: { id: string; image: string; daysBefore: number; daysAfter: number },
): Promise<Result> {
  const gate = await requirePlus(deps)
  if (gate) return gate
  const row = await deps.store.get(did)
  if (!row || !isValidTimeZone(row.timezone)) return fail(NO_ZONE)
  const { country, region } = row.holidays
  if (!country || !deps.holidays) return fail(NO_COUNTRY)
  const before = windowDays(input.daysBefore)
  const after = windowDays(input.daysAfter)
  if (before === null || after === null) return fail(`Days before and after must be whole numbers from 0 to ${MAX_WINDOW_DAYS}.`)
  const year = Number(localDate(deps.now(), row.timezone).slice(0, 4))
  const source = deps.holidays.occurrences(country, region)
  if (![year, year + 1].some((y) => source(input.id, y).length > 0)) return fail('That holiday is not on your country list.')
  const { images, ok } = await originals(deps)
  if (!ok.has(input.image)) return fail('Choose one of your original images.')
  if (!images.some((i) => i.value.isDefault === true)) return fail(NO_DEFAULT)
  const pick = { id: input.id, image: input.image, daysBefore: before, daysAfter: after }
  const exists = row.holidays.picks.some((p) => p.id === input.id)
  if (!exists && row.holidays.picks.length >= MAX_HOLIDAY_PICKS) return fail('You have reached the holiday limit.')
  const picks = exists ? row.holidays.picks.map((p) => (p.id === input.id ? pick : p)) : [...row.holidays.picks, pick]
  await deps.store.patch(did, { holidays: { country, region, picks }, nextChangeAt: deps.now() })
  return done('Holiday saved.')
}

export async function removeHolidayPick(deps: ScheduleDeps, did: string, id: string): Promise<Result> {
  const row = await deps.store.get(did)
  if (!row || !row.holidays.picks.some((p) => p.id === id)) return done('That holiday was already removed.')
  await deps.store.patch(did, { holidays: { ...row.holidays, picks: row.holidays.picks.filter((p) => p.id !== id) }, nextChangeAt: deps.now() })
  return done('Holiday removed.')
}
