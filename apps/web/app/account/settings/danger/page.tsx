import { PageMain } from '../../../../components/Page'
import { Button } from '../../../../components/Button'
import { BILLING_RETENTION_YEARS, DELETE_CONFIRMATION } from '../../../../lib/account-data'
import { requireDid } from '../../../../lib/auth'
import { HOLD_DAYS } from '../../../../lib/email-policy'
import { homeServerFor } from '../../../../lib/home-server'
import { viewerFor } from '../../../../lib/viewer'
import { displayName } from '../../../../lib/viewer-core'
import { deleteMyData } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Danger zone' }

export default async function DangerZonePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const did = await requireDid('/account/settings/danger')
  const viewer = await viewerFor(did)
  const homeServer = await homeServerFor(did)
  const { error } = await searchParams
  return (
    <PageMain>
      <h1>Danger zone</h1>
      <p>
        Signed in as {displayName(viewer)}
        {viewer.handle && <small className="block text-bv-ink-3">Account ID: {did}</small>}
      </p>
      {error && <p role="alert">{error}</p>}

      <section aria-labelledby="download">
        <h2 id="download">Download a copy</h2>
        <p>
          This is safe and changes nothing. You get one file with what blueyvatar stores about you: your linked emails (the primary
          address is masked), profile links, verified accounts, who can see your avatar, your license and API key details (never the
          secret keys), your custom domain, daily profile view counts, any appeals you filed, your avatar sync setting and the log of changes blueyvatar made to your profile avatar, and a summary of your subscriptions.
        </p>
        <p>
          <a href="/account/data/export" download>Download my data</a>
        </p>
      </section>

      <section aria-labelledby="danger" className="mt-10 rounded-bv-card border-2 border-red-700 p-5">
        <h2 id="danger" className="mt-0">Danger zone: delete my blueyvatar data</h2>
        <p>
          <strong>This cannot be undone.</strong> It removes what blueyvatar stores about you and signs you out.
        </p>
        <p>What we delete:</p>
        <ul>
          <li>Your linked emails and domains, pending codes, and your saved primary email. We keep a fingerprint of each email for {HOLD_DAYS} days so nobody else can claim it right away.</li>
          <li>Your profile links, verified accounts, and visibility settings.</li>
          <li>Your license and API keys, which stop working at once. You leave any organization you belong to. An organization you created is deleted along with its keys, unless it still has other members. In that case, remove them first.</li>
          <li>Your custom domain, including its Cloudflare hostname.</li>
          <li>Your daily profile view counts, any appeals you filed, and your avatar sync setting and change log.</li>
          <li>Our copy of your avatars and profile, with cached versions cleared.</li>
          <li>Your sign-in sessions.</li>
        </ul>
        <p>What we keep:</p>
        <ul>
          <li>
            Billing records from Stripe, for {BILLING_RETENTION_YEARS} years from the day you delete, for tax and accounting. Any
            active subscription is canceled right away. These records are used for nothing else and are deleted automatically
            after {BILLING_RETENTION_YEARS} years.
          </li>
          <li>The {HOLD_DAYS}-day email fingerprints named above, which expire on their own.</li>
          <li>Moderation records, such as blocks on images and reports about your account.</li>
        </ul>
        <p>
          Your avatars, profile, gallery, and verified accounts are saved on {homeServer}. A home server is the service
          that stores your account and everything you post. They belong to you, and blueyvatar does not delete them. To
          remove them, use an app that manages your repository or your home server&apos;s tools. Until you do, blueyvatar may show them again if you
          sign in later.
        </p>
        <form action={deleteMyData}>
          <label>
            Type <code>{DELETE_CONFIRMATION}</code> to confirm{' '}
            <input name="confirm" required autoComplete="off" spellCheck={false} />
          </label>{' '}
          <Button type="submit" variant="primary">Delete my blueyvatar data</Button>
        </form>
      </section>
    </PageMain>
  )
}
