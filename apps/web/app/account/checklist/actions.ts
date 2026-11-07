'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireDid } from '../../../lib/auth'
import { CHECKLIST_COOKIE, parsePrefs, serializePrefs } from '../../../lib/onboarding'

/** Hide or show the checklist again once it is complete. The choice lives in a cookie on this browser. */
export async function setChecklistShown(form: FormData): Promise<void> {
  await requireDid('/account')
  const jar = await cookies()
  const prefs = parsePrefs(jar.get(CHECKLIST_COOKIE)?.value)
  jar.set(CHECKLIST_COOKIE, serializePrefs({ ...prefs, showAgain: form.get('show') === '1' }), { path: '/account', maxAge: 365 * 24 * 3600, sameSite: 'lax', httpOnly: true })
  return redirect('/account')
}
