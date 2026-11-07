'use client'
import { useActionState } from 'react'
import { Button } from '../../../components/Button'
import { saveNotifications, type NotificationState } from './actions'

export function NotificationsForm({ usageAlerts, billingNotices }: { usageAlerts: boolean; billingNotices: boolean }) {
  const [state, action, pending] = useActionState(saveNotifications, {} as NotificationState)
  return (
    <form action={action}>
      <p>
        <label>
          <input type="checkbox" name="usageAlerts" defaultChecked={usageAlerts} /> Usage alerts: an email when you reach 80 and 100 percent of your included monthly requests.
        </label>
      </p>
      <p>
        <label>
          <input type="checkbox" name="billingNotices" defaultChecked={billingNotices} /> Billing notices: failed payments, the end of a grace period, and canceled subscriptions.
        </label>
      </p>
      <Button type="submit" variant="primary" disabled={pending}>Save</Button>
      {state.saved && <p role="status">Saved.</p>}
    </form>
  )
}
