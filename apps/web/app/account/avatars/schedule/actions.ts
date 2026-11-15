'use server'

import { redirect } from 'next/navigation'
import { currentDid } from '../../../../lib/auth'
import { reportError } from '../../../../lib/obs'
import { RepoError } from '../../../../lib/repo'
import { removeDateEntry, saveTimezone, setDateEntry, setWeekly } from '../../../../lib/schedule/flow'
import { liveScheduleDeps } from '../../../../lib/schedule/live'
import type { Result } from '../../../../lib/effects/flow'

const back = (key: 'error' | 'done', value: string): never => redirect(`/account/avatars/schedule?${key}=${encodeURIComponent(value)}`)

async function run(go: (did: string) => Promise<Result>): Promise<never> {
  const did = (await currentDid()) ?? redirect('/login')
  let r: Result
  try {
    r = await go(did)
  } catch (err) {
    reportError('schedule action failed', err)
    return back('error', err instanceof RepoError ? err.message : 'Something went wrong. Try again.')
  }
  return r.ok ? back('done', r.message) : back('error', r.error)
}

export async function saveScheduleTimezone(form: FormData): Promise<void> {
  await run(async (did) => saveTimezone(await liveScheduleDeps(did), did, String(form.get('timezone') ?? '')))
}

export async function addScheduleDate(form: FormData): Promise<void> {
  await run(async (did) => setDateEntry(await liveScheduleDeps(did), did, { date: String(form.get('date') ?? ''), image: String(form.get('image') ?? '') }))
}

export async function removeScheduleDate(form: FormData): Promise<void> {
  await run(async (did) => removeDateEntry(await liveScheduleDeps(did), did, String(form.get('date') ?? '')))
}

export async function saveScheduleWeekly(form: FormData): Promise<void> {
  await run(async (did) => {
    const images: Record<number, string> = {}
    for (let w = 0; w < 7; w++) images[w] = String(form.get(`weekday-${w}`) ?? '')
    return setWeekly(await liveScheduleDeps(did), did, images)
  })
}
