import Link from 'next/link'
import { PageMain } from '../../components/Page'
import { BILLING_RETENTION_YEARS } from '../../lib/account-data'
import { HOLD_DAYS } from '../../lib/email-policy'

export const metadata = { title: 'Data deleted' }

export default function DataDeletedPage() {
  return (
    <PageMain>
      <h1>Your BlueyVatar data is deleted</h1>
      <p>You are signed out. Here is what we kept and why.</p>
      <ul>
        <li>Stripe billing records, for {BILLING_RETENTION_YEARS} years for tax and accounting, then they are deleted automatically.</li>
        <li>A hash of each email you had linked, for {HOLD_DAYS} days, so no one else can claim it right away.</li>
        <li>Moderation records, such as blocks on images and reports about your account.</li>
      </ul>
      <p>
        Your avatars, profile, gallery, and claims in your own atproto repository are not ours to delete. They stay on your PDS until you
        remove them there.
      </p>
      <p>
        Questions? See the <Link href="/privacy">privacy page</Link>.
      </p>
    </PageMain>
  )
}
