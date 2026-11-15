import { SECURITY_NOTICES } from '@blueyvatar/core/verification'
import Link from 'next/link'
import { PageHeader, PageMain, Section } from '../../../components/Page'
import { requireDid } from '../../../lib/auth'
import { getNoticeDirectory } from '../../../lib/notify'
import { getStore } from '../../../lib/store'
import { NotificationsForm } from './NotificationsForm'

export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
  const did = await requireDid('/account/notifications')
  const [prefs, address] = await Promise.all([getNoticeDirectory().prefs(did), getStore().links.noticeAddress(did)])
  return (
    <PageMain>
      <PageHeader title="Notifications" intro="Pick which emails you get from BlueyVatar. Security notices always come." />
      <p>Signed in as {did}</p>
      {!address && <p role="status">No primary email is on file, so no notices can be sent. Link an email on the <Link href="/account/verify">Verify</Link> page to receive them.</p>}
      <Section title="Optional">
        <NotificationsForm usageAlerts={prefs.usageAlerts} billingNotices={prefs.billingNotices} offerNotices={prefs.offerNotices !== false} />
      </Section>
      <Section title="Always sent" intro="Security notices cannot be turned off:">
        <ul>
          {SECURITY_NOTICES.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Section>
    </PageMain>
  )
}
