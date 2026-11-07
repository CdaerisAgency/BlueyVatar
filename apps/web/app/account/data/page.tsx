import { PageMain } from '../../../components/Page'
import { Button } from '../../../components/Button'
import { BILLING_RETENTION_YEARS, DELETE_CONFIRMATION } from '../../../lib/account-data'
import { requireDid } from '../../../lib/auth'
import { HOLD_DAYS } from '../../../lib/email-policy'
import AccountNav from '../AccountNav'
import { deleteMyData } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your data' }

export default async function DataPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const did = await requireDid('/account/data')
  const { error } = await searchParams
  return (
    <PageMain>
      <AccountNav />
      <h1>Your data</h1>
      <p>Signed in as {did}</p>
      {error && <p role="alert">{error}</p>}
      <h2>Download my data</h2>
      <p>
        A JSON file with what blueyvatar holds about you: email link hashes and methods (the primary address only in masked form),
        profile links, claims and attestations, visibility rules, license and API key details (never key secrets), your custom
        domain, and a summary of your subscriptions.
      </p>
      <p>
        <a href="/account/data/export" download>Download my data</a>
      </p>
      <h2>Delete my blueyvatar data</h2>
      <p>This removes what blueyvatar holds about you and signs you out. It cannot be undone.</p>
      <p>Deleted:</p>
      <ul>
        <li>Linked email hashes and domains, pending codes, and the encrypted primary email. Each hash is held for {HOLD_DAYS} days so no other account can claim it right away.</li>
        <li>Profile links, claims, attestations, and visibility rules.</li>
        <li>Your license and API keys, which stop working at once.</li>
        <li>Your custom domain, including its Cloudflare hostname.</li>
        <li>Your indexed avatars and profile, with their cached copies purged.</li>
        <li>Your sign-in session.</li>
      </ul>
      <p>Kept:</p>
      <ul>
        <li>
          Stripe billing records (customer and subscription records), for {BILLING_RETENTION_YEARS} years from the day you delete your
          data, for tax and accounting. Any active subscription is canceled right away. These records are used for nothing else and
          are deleted automatically after {BILLING_RETENTION_YEARS} years.
        </li>
        <li>The {HOLD_DAYS}-day email holds named above, which expire on their own.</li>
        <li>Moderation records, such as blocks on images and reports about your account.</li>
      </ul>
      <p>
        Your avatars, profile, gallery, and claims are records in your own atproto repository on your PDS. They belong to you, and
        blueyvatar does not delete them. Remove them in your atproto client or from your PDS if you want them gone. Until you do,
        blueyvatar may index them again if you use it later.
      </p>
      <form action={deleteMyData}>
        <label>
          Type <code>{DELETE_CONFIRMATION}</code> to confirm{' '}
          <input name="confirm" required autoComplete="off" spellCheck={false} />
        </label>{' '}
        <Button type="submit" variant="primary">Delete my blueyvatar data</Button>
      </form>
    </PageMain>
  )
}
