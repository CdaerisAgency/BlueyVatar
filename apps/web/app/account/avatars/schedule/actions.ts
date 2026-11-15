'use server'

import { actionRunner } from '../../../../lib/action-run'
import { removeDateEntry, saveTimezone, setDateEntry, setWeekly } from '../../../../lib/schedule/flow'
import { liveScheduleDeps } from '../../../../lib/schedule/live'

const run = actionRunner('/account/avatars/schedule', 'schedule action failed')

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
