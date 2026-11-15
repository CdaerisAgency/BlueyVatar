'use server'

import { actionRunner } from '../../../../lib/action-run'
import { removeHolidayPick, setHolidayCountry, setHolidayPick } from '../../../../lib/schedule/holiday-flow'
import { liveScheduleDeps } from '../../../../lib/schedule/live'
import type { Result } from '../../../../lib/effects/flow'

const runAction = actionRunner('/account/avatars/holidays', 'holiday action failed')
const run = (form: FormData, go: (did: string) => Promise<Result>) => runAction(go, { suffix: form.get('popular') === '1' ? '&popular=1' : '' })

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
