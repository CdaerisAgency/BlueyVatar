import Link from 'next/link'
import { BackLink, EmptyState, Note, Notices, PageHeader, PageMain, Section } from '../../../../components/Page'
import { Button } from '../../../../components/Button'
import { Field } from '../../../../components/Field'
import { requireDid } from '../../../../lib/auth'
import { RepoError, blobUrl, listImages, pdsUrl, repoSession, type StoredImage } from '../../../../lib/repo'
import { resolvePlan } from '../../../../lib/plan'
import { getEffectsStore } from '../../../../lib/effects/store'
import { getScheduleStore } from '../../../../lib/schedule/store'
import { holidaysOf, countryNames, regionsOf, nextOccurrence } from '../../../../lib/holidays/data'
import { isValidTimeZone, localDate, windowOf, MAX_WINDOW_DAYS, resolveHoliday, type HolidayOccurrence } from '@blueyvatar/core'
import { occurrenceSource } from '../../../../lib/holidays/data'
import { removeHolidayPickAction, saveHolidayCountry, saveHolidayPick } from './actions'
import { HolidayCredit } from './HolidayCredit'


const imageName = (i: StoredImage | undefined) => (i ? i.value.alt || `Image from ${i.value.createdAt.slice(0, 10)}` : 'Image missing')

function longDate(date: string, withYear = true): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: withYear ? 'long' : undefined, year: withYear ? 'numeric' : undefined, month: 'long', day: 'numeric' })
}

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string; popular?: string }> }) {
  const did = await requireDid('/account/avatars/holidays')
  const { error, done, popular: popularParam } = await searchParams
  const showPopular = popularParam === '1'
  const plan = await resolvePlan(did)
  const [row, effects] = await Promise.all([getScheduleStore().get(did), getEffectsStore().get(did)])
  let images: StoredImage[] = []
  let pds = ''
  let loadError: string | null = null
  try {
    const session = await repoSession(did)
    ;[images, pds] = await Promise.all([listImages(session), pdsUrl(session)])
  } catch (err) {
    loadError = err instanceof RepoError ? err.message : 'Could not read your repository.'
  }
  const renders = new Set([effects.frameImageRkey, effects.awayImageRkey])
  const originals = images.filter((i) => !renders.has(i.rkey))
  const byRkey = new Map(images.map((i) => [i.rkey, i]))
  const plus = plan === 'plus'
  const zoneOk = !!row && isValidTimeZone(row.timezone)
  const today = zoneOk ? localDate(new Date(), row.timezone) : ''
  const settings = row?.holidays
  const country = settings?.country ?? ''
  const hasDefault = images.some((i) => i.value.isDefault === true)
  const names = countryNames()
  const countryOptions = Object.entries(names).sort((a, b) => a[1].localeCompare(b[1], 'en'))
  const regions = country ? Object.entries(regionsOf(country)).sort((a, b) => a[1].localeCompare(b[1], 'en')) : []
  const picks = new Map((settings?.picks ?? []).map((p) => [p.id, p]))

  // Every holiday that still has a date ahead, soonest first. Picked holidays always show, popular ones only on request.
  const list = zoneOk && country
    ? (() => {
        const year = Number(today.slice(0, 4))
        const seen = new Map<string, { id: string; name: string; popular: boolean; next: HolidayOccurrence }>()
        for (const y of [year, year + 1]) {
          for (const h of holidaysOf(country, settings!.region, y)) {
            if (seen.has(h.id) || h.start < today) continue
            seen.set(h.id, { id: h.id, name: h.name, popular: h.popular, next: { start: h.start, days: h.days } })
          }
        }
        return [...seen.values()].filter((h) => picks.has(h.id) || showPopular || !h.popular).sort((a, b) => (a.next.start < b.next.start ? -1 : 1))
      })()
    : []
  const lost = (settings?.picks ?? []).filter((p) => zoneOk && !list.some((h) => h.id === p.id) && !nextOccurrence(country, settings!.region, p.id, today))
  const source = zoneOk && country ? occurrenceSource(country, settings!.region) : null
  const showingToday = zoneOk && source ? resolveHoliday(settings!.picks, source, today) : null

  return (
    <PageMain>
      <BackLink href="/account/avatars/schedule">Back to the avatar calendar</BackLink>
      <PageHeader title="Holiday avatars" intro="Pick your country, then choose an image for each holiday you care about. It shows from a few days before the holiday until a few days after." />
      <Notices error={error} done={done} loadError={loadError} />
      <Note>
        <p>
          Only holidays you pick are used, and your own default avatar shows on every other day. A day entry on the avatar calendar beats a holiday, and a holiday beats a weekly entry. If two holidays overlap, the holiday whose own days include today wins, then the closest one, then the one coming up over the one just past, then the one you picked first. A day starts at midnight in your own time zone, not the country&apos;s. Your picks are kept by BlueyVatar and are not public.
        </p>
      </Note>

      {!plus ? (
        <Section title="Plus plan">
          <EmptyState action={{ href: '/account/billing', label: 'See the Plus plan' }}>Holiday avatars are part of the Plus plan, with the avatar calendar.</EmptyState>
        </Section>
      ) : !zoneOk ? (
        <Section title="Time zone">
          <EmptyState action={{ href: '/account/avatars/schedule', label: 'Open the avatar calendar' }}>Save your time zone on the avatar calendar first. Holidays use it to decide when a day starts.</EmptyState>
        </Section>
      ) : (
        <>
          {!loadError && !hasDefault && (
            <p role="alert">
              You need a default avatar before you can pick holidays. It shows whenever no holiday is active. <Link href="/account/avatars">Set a default avatar</Link>.
            </p>
          )}
          <Section title="Country" intro="Holidays are listed for one country. Changing the country removes your picks.">
            <form action={saveHolidayCountry}>
              {showPopular && <input type="hidden" name="popular" value="1" />}
              <Field prefix="holiday" name="country" label="Country">
                <select name="country" id="holiday-country" defaultValue={country}>
                  <option value="">No country (holidays off)</option>
                  {countryOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              </Field>
              {regions.length > 0 && (
                <Field prefix="holiday" name="region" label="Region" hint="Optional. Adds the holidays of one state or province.">
                  <select name="region" id="holiday-region" defaultValue={settings?.region ?? ''}>
                    <option value="">Whole country</option>
                    {regions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                  </select>
                </Field>
              )}
              <Button type="submit" variant="primary">Show holidays</Button>
            </form>
          </Section>

          {country && !loadError && (
            <>
              <Section title="Right now">
                <p>{showingToday ? `Today (${today}) shows ${imageName(byRkey.get(showingToday.image))} for a holiday. A day entry on the calendar can still beat it.` : `No holiday applies today (${today}).`}</p>
              </Section>
              <Section title={`Holidays in ${names[country] ?? country}`} intro="Public holidays are listed first. Popular days are observances and optional days that are widely marked without a day off.">
                <form method="get">
                  <label>
                    <input type="checkbox" name="popular" value="1" defaultChecked={showPopular} /> Also show popular days
                  </label>{' '}
                  <Button type="submit" variant="secondary">Update list</Button>
                </form>
                {originals.length === 0 ? (
                  <EmptyState action={{ href: '/account/avatars#upload', label: 'Upload an image' }}>Upload an image first, then pick it for a holiday.</EmptyState>
                ) : list.length === 0 ? (
                  <EmptyState>No upcoming holidays are listed for this choice.</EmptyState>
                ) : (
                  <ul>
                    {list.map((h) => {
                      const pick = picks.get(h.id)
                      const prefix = `hol-${h.id}`
                      const win = pick ? windowOf(pick, h.next) : null
                      const overlaps = pick
                        ? [...picks.values()].filter((o) => {
                            if (o.id === pick.id) return false
                            const next = list.find((x) => x.id === o.id)
                            if (!next) return false
                            const w = windowOf(o, next.next)
                            return win !== null && w.from <= win.to && w.to >= win.from
                          })
                        : []
                      return (
                        <li key={h.id}>
                          <form action={saveHolidayPick}>
                            <input type="hidden" name="id" value={h.id} />
                            {showPopular && <input type="hidden" name="popular" value="1" />}
                            <fieldset>
                              <legend>
                                {h.name}
                                {h.popular ? ' (popular)' : ''}
                              </legend>
                              <p>
                                Next: <time dateTime={h.next.start}>{longDate(h.next.start)}</time>
                                {h.next.days > 1 ? ` for ${h.next.days} days` : ''}
                              </p>
                              <Field prefix={prefix} name="image" label={`Avatar for ${h.name}`}>
                                <select name="image" id={`${prefix}-image`} defaultValue={pick?.image ?? originals[0]!.rkey}>
                                  {originals.map((i) => <option key={i.rkey} value={i.rkey}>{imageName(i)}</option>)}
                                </select>
                              </Field>
                              <Field prefix={prefix} name="daysBefore" label="Days before">
                                <input type="number" inputMode="numeric" name="daysBefore" id={`${prefix}-daysBefore`} min={0} max={MAX_WINDOW_DAYS} defaultValue={pick?.daysBefore ?? 0} required />
                              </Field>
                              <Field prefix={prefix} name="daysAfter" label="Days after">
                                <input type="number" inputMode="numeric" name="daysAfter" id={`${prefix}-daysAfter`} min={0} max={MAX_WINDOW_DAYS} defaultValue={pick?.daysAfter ?? 0} required />
                              </Field>
                              {pick && win && (
                                <p>
                                  {/* The blob is served by the user's home server, so next/image optimization does not apply. */}
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={blobUrl(pds, did, byRkey.get(pick.image)?.value.image.ref.$link ?? '')} alt="" className="size-10 inline-block object-cover" referrerPolicy="no-referrer" /> Shows {longDate(win.from, false)} to {longDate(win.to, false)}.
                                </p>
                              )}
                              {overlaps.length > 0 && <p>Overlaps {overlaps.map((o) => list.find((x) => x.id === o.id)!.name).join(', ')}. The closer holiday wins.</p>}
                              <Button type="submit" variant="primary" aria-label={`Save ${h.name}`}>{pick ? 'Save changes' : 'Use for this holiday'}</Button>
                            </fieldset>
                          </form>
                          {pick && (
                            <form action={removeHolidayPickAction}>
                              <input type="hidden" name="id" value={h.id} />
                              {showPopular && <input type="hidden" name="popular" value="1" />}
                              <Button type="submit" variant="danger" aria-label={`Remove ${h.name}`}>Remove</Button>
                            </form>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
                {lost.length > 0 && (
                  <>
                    <p>These picks are no longer on the country list and do nothing:</p>
                    <ul>
                      {lost.map((p) => (
                        <li key={p.id}>
                          <form action={removeHolidayPickAction}>
                            <input type="hidden" name="id" value={p.id} />
                            {p.id} <Button type="submit" variant="danger" aria-label={`Remove ${p.id}`}>Remove</Button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Section>
            </>
          )}
        </>
      )}
      <Section title="Holiday data credit" id="credit">
        <HolidayCredit />
      </Section>
    </PageMain>
  )
}
