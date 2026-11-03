'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { getDashboardStore } from '../../../lib/dashboard-store'
import { parseVisibilityForm } from '../../../lib/visibility'

export interface VisibilityState {
  error?: string
  saved?: boolean
}

export async function saveVisibility(_prev: VisibilityState, form: FormData): Promise<VisibilityState> {
  const did = await currentDid()
  if (!did) return redirect('/login')
  const r = parseVisibilityForm({
    keyedOnly: form.get('keyedOnly') === 'on',
    domainAllowlistOn: form.get('domainAllowlistOn') === 'on',
    domains: String(form.get('domains') ?? ''),
    hiddenProfile: form.get('hiddenProfile') === 'on',
    emailLookupOptOut: form.get('emailLookupOptOut') === 'on',
  })
  if (!r.ok) return { error: r.errors.join(' ') }
  await getDashboardStore().setRules(did, r.rules)
  revalidatePath('/account/visibility')
  return { saved: true }
}
