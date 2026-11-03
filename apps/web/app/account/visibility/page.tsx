import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { getDashboardStore } from '../../../lib/dashboard-store'
import { isPublic, PUBLIC_DATA_NOTICE } from '../../../lib/visibility'
import { VisibilityForm } from './VisibilityForm'

export const dynamic = 'force-dynamic'

export default async function VisibilityPage() {
  const did = await currentDid()
  if (!did) redirect('/login')
  const rules = await getDashboardStore().getRules(did)
  return (
    <main>
      <h1>Visibility</h1>
      <p>Signed in as {did}</p>
      <p>Current setting: {isPublic(rules) ? 'Public. Anyone can fetch your avatar and profile.' : 'Restricted by the rules below.'}</p>
      <div role="note" style={{ border: '1px solid currentColor', padding: 12, margin: '12px 0' }}>
        <p>
          <strong>Your avatar in your repo stays public.</strong>
        </p>
        <p>{PUBLIC_DATA_NOTICE}</p>
      </div>
      <VisibilityForm rules={rules} />
    </main>
  )
}
