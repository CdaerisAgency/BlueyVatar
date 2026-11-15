'use server'

import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { limited } from '../../../lib/rate-guard'
import { reportError } from '../../../lib/obs'
import { RepoError } from '../../../lib/repo'
import { isValidTimezone } from '../../../lib/records'
import { applyFrame, removeFrame, scheduleAway, turnOffAway, type Result } from '../../../lib/effects/flow'
import { liveDeps } from '../../../lib/effects/live'

const back = (key: 'error' | 'done', value: string): never => redirect(`/account/effects?${key}=${encodeURIComponent(value)}`)

async function run(bucketed: boolean, go: (did: string) => Promise<Result>): Promise<never> {
  const did = (await currentDid()) ?? redirect('/login')
  if (bucketed) {
    const wait = await limited(['upload.did', 'upload.ip'], did)
    if (wait) return back('error', wait)
  }
  let r: Result
  try {
    r = await go(did)
  } catch (err) {
    reportError('effects action failed', err)
    return back('error', err instanceof RepoError ? err.message : 'Something went wrong. Try again.')
  }
  return r.ok ? back('done', r.message) : back('error', r.error)
}

/** Rendering writes an image to the repository, so it shares the upload rate limit. */
export async function saveFrame(form: FormData): Promise<void> {
  await run(true, async (did) => applyFrame(await liveDeps(did), did, {
    sourceRkey: String(form.get('source') ?? ''), style: String(form.get('style') ?? ''), color: String(form.get('color') ?? ''), filter: String(form.get('filter') ?? ''),
  }))
}

export async function deleteFrame(): Promise<void> {
  await run(false, async (did) => removeFrame(await liveDeps(did), did))
}

export async function saveAway(form: FormData): Promise<void> {
  await run(false, async (did) => {
    const timezone = String(form.get('timezone') ?? '').trim()
    if (!isValidTimezone(timezone)) return { ok: false, error: 'Enter a time zone such as America/New_York or UTC.' }
    return scheduleAway(await liveDeps(did), did, { start: String(form.get('start') ?? ''), end: String(form.get('end') ?? ''), timezone })
  })
}

export async function cancelAway(): Promise<void> {
  await run(false, async (did) => turnOffAway(await liveDeps(did), did))
}
