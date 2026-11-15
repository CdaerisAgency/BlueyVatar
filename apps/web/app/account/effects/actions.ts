'use server'

import { actionRunner } from '../../../lib/action-run'
import { isValidTimezone } from '../../../lib/records'
import { applyFrame, removeFrame, scheduleAway, turnOffAway } from '../../../lib/effects/flow'
import { liveDeps } from '../../../lib/effects/live'

const run = actionRunner('/account/effects', 'effects action failed')

/** Rendering writes an image to the repository, so it shares the upload rate limit. */
export async function saveFrame(form: FormData): Promise<void> {
  await run(async (did) => applyFrame(await liveDeps(did), did, {
    sourceRkey: String(form.get('source') ?? ''), style: String(form.get('style') ?? ''), color: String(form.get('color') ?? ''), filter: String(form.get('filter') ?? ''),
  }), { limit: ['upload.did', 'upload.ip'] })
}

export async function deleteFrame(): Promise<void> {
  await run(async (did) => removeFrame(await liveDeps(did), did))
}

export async function saveAway(form: FormData): Promise<void> {
  await run(async (did) => {
    const timezone = String(form.get('timezone') ?? '').trim()
    if (!isValidTimezone(timezone)) return { ok: false, error: 'Enter a time zone such as America/New_York or UTC.' }
    return scheduleAway(await liveDeps(did), did, { start: String(form.get('start') ?? ''), end: String(form.get('end') ?? ''), timezone })
  })
}

export async function cancelAway(): Promise<void> {
  await run(async (did) => turnOffAway(await liveDeps(did), did))
}
