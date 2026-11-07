'use server'

import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { RepoError, getProfile, putProfile, repoSession, type ProfileRecord } from '../../../lib/repo'
import { validateProfile } from '../../../lib/records'
import { reportError } from '../../../lib/obs'
import { limited } from '../../../lib/rate-guard'
import { profileColors } from '@blueyvatar/core'

const back = (key: 'error' | 'done', value: string): never => redirect(`/account/profile?${key}=${encodeURIComponent(value)}`)

const FIELDS = ['jobTitle', 'company', 'location', 'pronouns', 'pronunciation', 'timezone', 'interests', 'backgroundColor'] as const

export async function saveProfile(form: FormData): Promise<void> {
  const did = (await currentDid()) ?? redirect('/login')
  const input = Object.fromEntries(FIELDS.map((k) => [k, String(form.get(k) ?? '')])) as Record<(typeof FIELDS)[number], string>
  // A color input always submits a value, so clearing is its own checkbox.
  if (form.get('clearBackgroundColor') === 'on') input.backgroundColor = ''
  const checked = validateProfile(input)
  if (!checked.ok) return back('error', checked.error)
  const wait = await limited(['profileSave.did'], did)
  if (wait) return back('error', wait)
  try {
    const session = await repoSession(did)
    const existing = await getProfile(session)
    // Replace the editable fields, keep everything else (defaultImage, createdAt, future fields).
    const kept: ProfileRecord = { ...(existing?.value ?? { createdAt: new Date().toISOString() }) }
    for (const k of FIELDS) delete kept[k]
    await putProfile(session, { ...kept, ...checked.value }, existing?.cid)
  } catch (err) {
    reportError('profile save failed', err)
    return back('error', err instanceof RepoError ? err.message : 'Something went wrong. Try again.')
  }
  const color = checked.value.backgroundColor
  if (color && !profileColors(color)) return back('done', 'Profile saved. That background color has too little contrast with text, so your page will use the default colors. Pick a lighter or darker shade.')
  return back('done', 'Profile saved.')
}
