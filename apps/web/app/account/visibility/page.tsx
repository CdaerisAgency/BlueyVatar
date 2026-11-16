import { Note, PageHeader, PageMain } from '../../../components/Page'
import { SignedInAs } from '../../../components/SignedInAs'
import { requireDid } from '../../../lib/auth'
import { getDashboardStore } from '../../../lib/dashboard-store'
import { isPublic, PUBLIC_DATA_NOTICE } from '../../../lib/visibility'
import { VisibilityForm } from './VisibilityForm'


export default async function VisibilityPage() {
  const did = await requireDid('/account/visibility')
  const rules = await getDashboardStore().getRules(did)
  return (
    <PageMain>
      <PageHeader title="Visibility" intro="Choose who can fetch your avatar and profile, and whether apps can find you by email." />
      <SignedInAs did={did} />
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
