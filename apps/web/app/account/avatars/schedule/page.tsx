import Link from 'next/link'
import { EmptyState, Note, PageHeader, PageMain, Section } from '../../../../components/Page'
import { Button } from '../../../../components/Button'
import { Field } from '../../../../components/Field'
import { requireDid } from '../../../../lib/auth'
import { RepoError, blobUrl, getProfile, listImages, pdsUrl, repoSession, type StoredImage } from '../../../../lib/repo'
import { resolvePlan } from '../../../../lib/plan'
import { getEffectsStore } from '../../../../lib/effects/store'
import { getScheduleStore } from '../../../../lib/schedule/store'
import { holidayHook } from '../../../../lib/schedule/flow'
import { liveHolidayData } from '../../../../lib/holidays/data'
import { activeEntry, isValidTimeZone, localDate, nextChange } from '@blueyvatar/core'
import { addScheduleDate, removeScheduleDate, saveScheduleTimezone, saveScheduleWeekly } from './actions'
import { TimezoneInput } from './TimezoneInput'


const WEEKDAYS = [
  { n: 1, label: 'Monday' }, { n: 2, label: 'Tuesday' }, { n: 3, label: 'Wednesday' }, { n: 4, label: 'Thursday' },
  { n: 5, label: 'Friday' }, { n: 6, label: 'Saturday' }, { n: 0, label: 'Sunday' },
] as const

const imageName = (i: StoredImage | undefined) => (i ? i.value.alt || `Image from ${i.value.createdAt.slice(0, 10)}` : 'Image missing')

function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const did = await requireDid('/account/avatars/schedule')
  const { error, done } = await searchParams
  const plan = await resolvePlan(did)
  const [row, effects] = await Promise.all([getScheduleStore().get(did), getEffectsStore().get(did)])
  let images: StoredImage[] = []
  let pds = ''
  let profileZone = 'UTC'
  let loadError: string | null = null
  try {
    const session = await repoSession(did)
    ;[images, pds] = await Promise.all([listImages(session), pdsUrl(session)])
    const tz = (await getProfile(session).catch(() => null))?.value.timezone
    if (typeof tz === 'string' && tz) profileZone = tz
  } catch (err) {
    loadError = err instanceof RepoError ? err.message : 'Could not read your repository.'
  }
  const renders = new Set([effects.frameImageRkey, effects.awayImageRkey])
  const originals = images.filter((i) => !renders.has(i.rkey))
  const byRkey = new Map(images.map((i) => [i.rkey, i]))
  const plus = plan === 'plus'
  const now = new Date()
  const zoneOk = !!row && isValidTimeZone(row.timezone)
  const today = zoneOk ? localDate(now, row.timezone) : ''
  const holiday = zoneOk && plus ? holidayHook({ holidays: liveHolidayData }, row) : undefined
  const nowEntry = zoneOk ? activeEntry(row.schedule, row.timezone, now, { holiday }) : null
  const next = zoneOk ? nextChange(row.schedule, row.timezone, now, { holiday }) : null
  const nextEntry = zoneOk && next ? activeEntry(row.schedule, row.timezone, next, { holiday }) : null
  const weekly = new Map((row?.schedule.weekly ?? []).map((w) => [w.weekday, w.image]))
  const upcoming = (row?.schedule.dates ?? []).filter((d) => d.date >= today)

  return (
    <PageMain>
      <PageHeader title="Avatar calendar" intro="Choose which of your images is your default avatar on which day. Your own default comes back on days with no entry." />
      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}
      {loadError && <p role="alert">{loadError}</p>}
      <Note>
        <p>Looking for holidays? Choose a country and an image per holiday on the <Link href="/account/avatars/holidays">Holiday avatars</Link> page. On each change, BlueyVatar sets the scheduled image as your default image in your Bluesky account, the same way the Default button does, and pushes it to apps you turned on. Dates and image choices are kept by BlueyVatar and are not public. Only your original images can be scheduled. A saved frame or filter look stays applied, and out-of-office wins: the calendar waits until it ends.</p>
      </Note>

      {!plus ? (
        <Section title="Plus plan">
          <EmptyState action={{ href: '/account/billing', label: 'See the Plus plan' }}>The avatar calendar is part of the Plus plan.</EmptyState>
        </Section>
      ) : (
        <>
          <Section title="Time zone" intro="A day starts and ends at midnight in this zone. Example: America/New_York.">
            <form action={saveScheduleTimezone}>
              <Field prefix="schedule" name="timezone" label="Time zone" required>
                <TimezoneInput saved={row?.timezone ?? null} fallback={profileZone} />
              </Field>
              <Button type="submit" variant="primary">Save time zone</Button>
            </form>
          </Section>

          {!zoneOk ? (
            <Section title="Days">
              <EmptyState>Save your time zone first, then add days.</EmptyState>
            </Section>
          ) : originals.length === 0 && !loadError ? (
            <Section title="Days">
              <EmptyState action={{ href: '/account/avatars#upload', label: 'Upload an image' }}>Upload an image first, then schedule it here.</EmptyState>
            </Section>
          ) : (
            !loadError && (
              <>
                <Section title="Right now">
                  <p>{nowEntry ? `Today (${today}) shows ${imageName(byRkey.get(nowEntry.image))}.` : `Today (${today}) shows your own default image.`}</p>
                  <p>{next ? `Next change: ${longDate(localDate(next, row!.timezone))}, to ${nextEntry ? imageName(byRkey.get(nextEntry.image)) : 'your own default image'}.` : 'No change is scheduled.'}</p>
                  {row?.state === 'failed' && row.lastError && <p role="alert">The last change did not work: {row.lastError} It tries again every 15 minutes.</p>}
                </Section>

                <Section title="Add a day" intro="Pick a date and an image. A day entry beats the weekly entry for that day.">
                  <form action={addScheduleDate}>
                    <Field prefix="sched-date" name="date" label="Date" required>
                      <input type="date" name="date" id="sched-date-date" required min={today} />
                    </Field>
                    <fieldset>
                      <legend>Image</legend>
                      {originals.map((i, n) => (
                        <label key={i.rkey}>
                          <input type="radio" name="image" value={i.rkey} defaultChecked={n === 0} />{' '}
                          {/* The blob is served by the user's home server, so next/image optimization does not apply. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={blobUrl(pds, did, i.value.image.ref.$link)} alt="" className="size-10 inline-block object-cover" referrerPolicy="no-referrer" /> {imageName(i)}
                        </label>
                      ))}
                    </fieldset>
                    <Button type="submit" variant="primary">Add day</Button>
                  </form>
                </Section>

                <Section title="Upcoming days">
                  {upcoming.length === 0 ? (
                    <EmptyState>No days are scheduled.</EmptyState>
                  ) : (
                    <ol>
                      {upcoming.map((d) => {
                        const img = byRkey.get(d.image)
                        return (
                          <li key={d.date}>
                            <form action={removeScheduleDate}>
                              <input type="hidden" name="date" value={d.date} />
                              <time dateTime={d.date}>{longDate(d.date)}</time>: {imageName(img)}{' '}
                              <Button type="submit" variant="danger" aria-label={`Remove ${longDate(d.date)}`}>Remove</Button>
                            </form>
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </Section>

                <Section title="Weekly" intro="Repeat an image on a day of the week. Choose Use my default to leave a day alone.">
                  <form action={saveScheduleWeekly}>
                    {WEEKDAYS.map((w) => (
                      <Field key={w.n} prefix="weekly" name={`weekday-${w.n}`} label={w.label}>
                        <select name={`weekday-${w.n}`} id={`weekly-weekday-${w.n}`} defaultValue={weekly.get(w.n) ?? ''}>
                          <option value="">Use my default</option>
                          {originals.map((i) => <option key={i.rkey} value={i.rkey}>{imageName(i)}</option>)}
                        </select>
                      </Field>
                    ))}
                    <Button type="submit" variant="primary">Save weekly days</Button>
                  </form>
                </Section>
              </>
            )
          )}
        </>
      )}
    </PageMain>
  )
}
