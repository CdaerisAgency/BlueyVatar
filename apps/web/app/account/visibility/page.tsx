import { Note, PageMain } from '../../../components/Page'
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
    <PageMain>
      <h1>Visibility</h1>
      <p>Signed in as {did}</p>
      <p>Current setting: {isPublic(rules) ? 'Public. Anyone can fetch your avatar and profile.' : 'Restricted by the rules below.'}</p>
      <Note>
        <p>
          <strong>Your avatar in your repo stays public.</strong>
        </p>
        <p>{PUBLIC_DATA_NOTICE}</p>
      </Note>
      <VisibilityForm rules={rules} />
    </PageMain>
  )
}
