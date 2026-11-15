'use server'

import { redirect } from 'next/navigation'
import { currentDid } from '../../../../lib/auth'
import { reportError } from '../../../../lib/obs'
import { RepoError } from '../../../../lib/repo'
import { removeHolidayPick, setHolidayCountry, setHolidayPick } from '../../../../lib/schedule/holiday-flow'
import { liveScheduleDeps } from '../../../../lib/schedule/live'
import type { Result } from '../../../../lib/effects/flow'

const back = (key: 'error' | 'done', value: string, popular: boolean): never =>
  redirect(`/account/avatars/holidays?${key}=${encodeURIComponent(value)}${popular ? '&popular=1' : ''}`)

async function run(form: FormData, go: (did: string) => Promise<Result>): Promise<never> {
  const did = (await currentDid()) ?? redirect('/login')
  const popular = form.get('popular') === '1'
  let r: Result
  try {
    r = await go(did)
  } catch (err) {
    reportError('holiday action failed', err)
    return back('error', err instanceof RepoError ? err.message : 'Something went wrong. Try again.', popular)
  }
  return r.ok ? back('done', r.message, popular) : back('error', r.error, popular)
}

export async function saveHolidayCountry(form: FormData): Promise<void> {
  await run(form, async (did) => setHolidayCountry(await liveScheduleDeps(did), did, { country: String(form.get('country') ?? ''), region: String(form.get('region') ?? '') }))
}

export async function saveHolidayPick(form: FormData): Promise<void> {
  await run(form, async (did) =>
    setHolidayPick(await liveScheduleDeps(did), did, {
      id: String(form.get('id') ?? ''),
      image: String(form.get('image') ?? ''),
      daysBefore: Number(form.get('daysBefore') ?? ''),
      daysAfter: Number(form.get('daysAfter') ?? ''),
    }),
  )
}

export async function removeHolidayPickAction(form: FormData): Promise<void> {
  await run(form, async (did) => removeHolidayPick(await liveScheduleDeps(did), did, String(form.get('id') ?? '')))
}
