'use server'

import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { cleanStatement, submitAppeal } from '../../../lib/appeals'
import { reportError } from '../../../lib/obs'
import { limited } from '../../../lib/rate-guard'
import { getPool } from '../../../lib/store'

const back = (action: unknown, key: 'sent' | 'error', value: string): never =>
  redirect(`/account/appeal?action=${encodeURIComponent(String(action ?? ''))}&${key}=${encodeURIComponent(value)}`)

/** Signed-in owners only. The statement is never logged. */
export async function submitAppealAction(form: FormData): Promise<void> {
  const did = await currentDid()
  if (!did) return redirect('/login')
  const action = form.get('action')
  const wait = await limited(['appeal.did', 'appeal.ip'], did)
  if (wait) return back(action, 'error', wait)
  if (!cleanStatement(form.get('statement'))) return back(action, 'error', 'Write a short statement (up to 2000 characters).')
  const pool = getPool()
  if (!pool) return back(action, 'error', 'Appeals need the database, which is not configured here.')
  try {
    const r = await submitAppeal(pool, did, Number(action), form.get('statement'))
    if (r.ok) return back(action, 'sent', String(r.id))
    return back(action, 'error', r.error === 'duplicate' ? 'This action already has an appeal. Only one appeal is allowed per action.' : 'That action cannot be appealed. It may have ended, or it is not on your account.')
  } catch (err) {
    if (err instanceof Error && 'digest' in err) throw err
    reportError('appeal submit failed', err)
    return back(action, 'error', 'Something went wrong. Try again later.')
  }
}
