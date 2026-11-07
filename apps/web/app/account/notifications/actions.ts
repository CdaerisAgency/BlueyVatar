'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { getNoticeDirectory } from '../../../lib/notify'

export interface NotificationState {
  saved?: boolean
}

/** Security notices have no field here on purpose: they are always sent. */
export async function saveNotifications(_prev: NotificationState, form: FormData): Promise<NotificationState> {
  const did = await currentDid()
  if (!did) return redirect('/login')
  await getNoticeDirectory().setPrefs(did, { usageAlerts: form.get('usageAlerts') === 'on', billingNotices: form.get('billingNotices') === 'on' })
  revalidatePath('/account/notifications')
  return { saved: true }
}
