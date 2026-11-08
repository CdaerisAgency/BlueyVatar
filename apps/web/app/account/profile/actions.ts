'use server'

import { currentDid } from '../../../lib/auth'
import { RepoError, getProfile, putProfile, repoSession, type ProfileRecord } from '../../../lib/repo'
import { reportError } from '../../../lib/obs'
import { limited } from '../../../lib/rate-guard'
import { profileColors } from '@blueyvatar/core'
import { PROFILE_FIELDS, runProfileSave, type ProfileFormState } from '../../../lib/profile-form'

/** Returns the result to the form instead of redirecting, so typed values stay in place. */
export async function saveProfile(_prev: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  const did = await currentDid()
  return runProfileSave(did, form, {
    limited: (d) => limited(['profileSave.did'], d),
    save: async (d, fields) => {
      const session = await repoSession(d)
      const existing = await getProfile(session)
      // Replace the editable fields, keep everything else (defaultImage, createdAt, future fields).
      const kept: ProfileRecord = { ...(existing?.value ?? { createdAt: new Date().toISOString() }) }
      for (const k of PROFILE_FIELDS) delete kept[k as keyof ProfileRecord]
      await putProfile(session, { ...kept, ...fields }, existing?.cid)
    },
    report: (err) => reportError('profile save failed', err),
    messageFor: (err) => (err instanceof RepoError ? err.message : 'Something went wrong. Try again.'),
    lowContrast: (c) => !profileColors(c),
  })
}
