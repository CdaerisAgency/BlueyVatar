'use server'

import { redirect } from 'next/navigation'
import { login } from '../actions'
import { safeNext } from '../../lib/next-path'
import { HANDLE_ERROR, normalizeHandle } from './handle'

/** Re-checks the handle on the server, then hands the normalized value to the shared sign-in action. */
export async function loginWithHandle(form: FormData): Promise<void> {
  const handle = normalizeHandle(String(form.get('handle') ?? ''))
  if (!handle) {
    const next = safeNext(String(form.get('next') ?? ''))
    return redirect(`/login?error=${encodeURIComponent(HANDLE_ERROR)}${next === '/account' ? '' : `&next=${encodeURIComponent(next)}`}`)
  }
  form.set('handle', handle)
  return login(form)
}
