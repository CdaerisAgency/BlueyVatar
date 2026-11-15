import { BackLink, PageHeader, PageMain } from '../../../components/Page'
import { Button } from '../../../components/Button'
import { SignedInAs } from '../../../components/SignedInAs'
import { billingEnabled } from '../../../lib/billing/config'
import { getBillingStore } from '../../../lib/billing/store'
import { getDashboardStore } from '../../../lib/dashboard-store'
import { PRICING, formatPrice } from '../../../lib/pricing'
import { canManageBilling } from '../../../lib/orgs/roles'
import { getOrganization, memberRole, orgLicense } from '../../../lib/orgs/store'
import { getPool } from '../../../lib/store'
import { viewerFor } from '../../../lib/viewer'
import { displayName } from '../../../lib/viewer-core'
import { LicenseUsage } from './LicenseUsage'
import { NOTICE, UNAVAILABLE } from './notices'
import { startCheckout, openPortal } from './actions'

const dateOf = (d: Date) => d.toISOString().slice(0, 10)

/** Billing for an organization license. Owners only; the Stripe customer is the billing owner's. */
export async function OrgBilling({ did, orgId, q }: { did: string; orgId: string; q: { checkout?: string; error?: string } }) {
  const pool = getPool()
  const role = pool ? await memberRole(pool, orgId, did) : null
  const org = pool && role ? await getOrganization(pool, orgId) : null
  const lic = pool && role ? await orgLicense(pool, orgId) : null
  if (!pool || !org || !lic) {
    return (
      <PageMain>
        <BackLink href="/account/orgs">Back to organizations</BackLink>
        <PageHeader title="Plan and billing" intro="See the plan and billing for an organization." />
        <p role="alert">You are not a member of that organization.</p>
      </PageMain>
    )
  }
  if (!canManageBilling(role)) {
    return (
      <PageMain>
        <BackLink href={`/account/orgs/${orgId}`}>Back to {org.name}</BackLink>
        <PageHeader title={`Plan and billing: ${org.name}`} intro="See the plan and billing for this organization." />
        <p role="alert">Only organization owners can manage billing.</p>
      </PageMain>
    )
  }
  const license = await getDashboardStore().licenseById(lic.licenseId)
  const sub = await getBillingStore().subscriptionFor(lic.billingDid, lic.licenseId)
  const enabled = billingEnabled()
  const business = PRICING.find((p) => p.id === 'business')
  return (
    <PageMain>
      <BackLink href={`/account/orgs/${orgId}`}>Back to {org.name}</BackLink>
      <PageHeader title={`Plan and billing: ${org.name}`} intro="Billing for this organization stays with its billing owner." />
      <SignedInAs did={did} />
      {q.checkout && NOTICE[q.checkout] && <p role="status">{NOTICE[q.checkout]}</p>}
      {q.error && <p role="alert">{q.error}</p>}
      <p>Billing for this organization stays with its billing owner, {displayName(await viewerFor(lic.billingDid))}. Any owner can start or manage the subscription.</p>
      <ul>
        <li>Developer tier: {license?.tier ?? 'free'}</li>
        {sub && <li>Subscription: {sub.status.replace('_', ' ')}{sub.currentPeriodEnd ? `, ${sub.cancelAtPeriodEnd ? 'ends' : 'renews'} ${dateOf(sub.currentPeriodEnd)}` : ''}</li>}
      </ul>
      {!enabled && <p>{UNAVAILABLE}</p>}
      {enabled && !sub && business && (
        <form action={startCheckout}>
          <input type="hidden" name="tier" value="business" />
          <input type="hidden" name="org" value={orgId} />
          <Button type="submit" variant="primary">Subscribe to Business ({formatPrice(business.amount)} per month)</Button>
        </form>
      )}
      {enabled && sub && (
        <form action={openPortal}>
          <input type="hidden" name="org" value={orgId} />
          <Button type="submit">Manage billing</Button>
        </form>
      )}
      <p>Prices exclude tax. Stripe Tax adds any sales tax or VAT at checkout.</p>
      {license && <LicenseUsage license={license} />}
    </PageMain>
  )
}
