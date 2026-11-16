import { BackLink, Notices, PageHeader, PageMain, Section } from '../../../../components/Page'
import { Button } from '../../../../components/Button'
import { BILLING_RETENTION_YEARS, DELETE_CONFIRMATION } from '../../../../lib/account-data'
import { Field } from '../../../../components/Field'
import { requireDid } from '../../../../lib/auth'
import { HOLD_DAYS } from '../../../../lib/email-policy'
import { homeServerHost } from '../../../../lib/home-server'
import { viewerFor } from '../../../../lib/viewer'
import { displayName } from '../../../../lib/viewer-core'
import { deleteMyData } from './actions'

export const metadata = { title: 'Danger zone' }

export default async function DangerZonePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const did = await requireDid('/account/settings/danger')
  const viewer = await viewerFor(did)
  const host = await homeServerHost(did)
  const homeServer = `your Bluesky account's home server${host ? ` (${host})` : ''}`
  const { error } = await searchParams
  return (
    <PageMain>
      <BackLink href="/account/settings">Back to sign-out options</BackLink>
      <PageHeader title="Danger zone" intro="Download a copy of what we store about you, or delete it." />
      <p>
        Signed in as {displayName(viewer)}
        <small className="block text-bv-ink-3">Account ID: {did}</small>
      </p>
      <Notices error={error} />

      <Section title="Download a copy" id="download">
        <p>
          This is safe and changes nothing. You get one file with what BlueyVatar stores about you: your linked emails (addresses are masked), profile links, linked accounts, who can see your avatar, your license and API key details (never the
          secret keys), your custom domain, daily profile view counts, any appeals you filed, your avatar sync setting and the log of changes blueyvatar made to your profile avatar, your avatar frame, out-of-office, calendar and holiday settings, free effect offers you were listed for or dismissed, bug report screenshots you sent, and a summary of your subscriptions.
        </p>
        <p>
          <a href="/account/data/export" download className="inline-flex min-h-11 items-center">Download my data</a>
        </p>
      </Section>

      <Section title="Delete my BlueyVatar data" id="danger" tone="danger">
        <p>
          <strong>This cannot be undone.</strong> It removes what BlueyVatar stores about you and signs you out.
        </p>
        <p>What we delete:</p>
        <ul>
          <li>Your linked emails and domains, pending codes, and your saved primary email. We keep a fingerprint of each email for {HOLD_DAYS} days so nobody else can claim it right away.</li>
          <li>Your profile links, linked accounts, and visibility settings.</li>
          <li>Your license and API keys, which stop working at once. You leave any organization you belong to. An organization you created is deleted along with its keys, unless it still has other members. In that case, remove them first.</li>
          <li>Your custom domain, including its Cloudflare hostname.</li>
          <li>Your daily profile view counts, any appeals you filed, your avatar sync setting and change log, your avatar frame, out-of-office, calendar and holiday settings, free effect offer records, and bug report screenshots you sent.</li>
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
          Your avatars, profile, gallery, and linked accounts are saved on {homeServer}. The home server is the service
          that stores your Bluesky account and everything you post. They belong to you, and BlueyVatar does not delete them. To
          remove them, use an app that manages your repository or your home server&apos;s tools. Until you do, BlueyVatar may show them again if you
          sign in later.
        </p>
        <form action={deleteMyData}>
          <Field prefix="delete" name="confirm" label={<>Type <code>{DELETE_CONFIRMATION}</code> to confirm</>} required>
            <input id="delete-confirm" name="confirm" required autoComplete="off" spellCheck={false} />
          </Field>
          <Button type="submit" variant="danger">Delete my BlueyVatar data</Button>
        </form>
      </Section>
    </PageMain>
  )
}
