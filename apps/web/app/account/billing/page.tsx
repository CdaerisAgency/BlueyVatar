import { PAID_PLANS, PAST_DUE_GRACE_DAYS, effectiveTier, type PaidPlan } from '@blueyvatar/core'
import { BackLink, PageHeader, PageMain, Section } from '../../../components/Page'
import { Button } from '../../../components/Button'
import { requireDid } from '../../../lib/auth'
import { billingEnabled, planEnabled } from '../../../lib/billing/config'
import { longDate, summarize } from '../../../lib/billing/summary'
import { getBillingStore } from '../../../lib/billing/store'
import { getPendingChange, stripeClient } from '../../../lib/billing/stripe'
import { getDashboardStore } from '../../../lib/dashboard-store'
import { resolvePlan } from '../../../lib/plan'
import { PRICING, formatPrice } from '../../../lib/pricing'
import { canManageBilling } from '../../../lib/orgs/roles'
import { getOrganization, memberRole, orgLicense } from '../../../lib/orgs/store'
import { getPool } from '../../../lib/store'
import { SignedInAs } from '../../../components/SignedInAs'
import { viewerFor } from '../../../lib/viewer'
import { displayName } from '../../../lib/viewer-core'
import { LicenseUsage } from './LicenseUsage'
import { cancelPlanChange, cancelSubscription, openPortal, resumeSubscription, startCheckout, switchPlan } from './actions'


const NOTICE: Record<string, string> = {
  success: 'Thanks. Your subscription is being set up. This page updates when Stripe confirms the payment, usually within a minute.',
  canceled: 'Checkout was canceled. You were not charged.',
}

const UNAVAILABLE = 'Billing is not available yet on this deployment, so plan changes are handled by hand. To change your plan now, email support@blueyvatar.com and include your handle.'
const PLAN_NAME: Record<string, string> = { plus: 'Plus', business: 'Business' }

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string; error?: string; done?: string; change?: string; org?: string }> }) {
  const did = await requireDid('/account/billing')
  const q = await searchParams
  const orgId = q.org || null
  if (orgId) return <OrgBilling did={did} orgId={orgId} q={q} />
  const license = await getDashboardStore().ensureLicense(did)
  const billing = getBillingStore()
  const [customer, sub, plan] = await Promise.all([billing.customerFor(did), billing.subscriptionFor(did, license.licenseId), resolvePlan(did)])
  const enabled = billingEnabled()
  const now = new Date()
  const tier = effectiveTier(license, now)
  const pastDue = license.status === 'past_due' && license.graceEndsAt
  const subs = sub ? [sub] : []
  // A downgrade waiting for the period to end lives in Stripe as a schedule. Read it each time, so a reload shows it.
  const pending = sub && enabled ? await getPendingChange({ store: billing, client: stripeClient(), baseUrl: '' }, sub, now) : null
  const enterprise = license.tier === 'enterprise'
  // The tier names a person currently holds, for the "(current)" marker. Enterprise is a contract and has no row on the list.
  const held = new Set<string>(subs.map((x) => x.tier))
  const target = q.change && (PAID_PLANS as readonly string[]).includes(q.change) ? (q.change as PaidPlan) : null
  const canSwitchTo = (id: PaidPlan) => planEnabled(id) && !enterprise

  return (
    <PageMain>
      <PageHeader title="Plan and billing" intro="See your plan, change it, and manage payment and invoices." />
      <SignedInAs did={did} />
      {q.checkout && NOTICE[q.checkout] && <p role="status">{NOTICE[q.checkout]}</p>}
      {q.done && <p role="status">{q.done}</p>}
      {q.error && <p role="alert">{q.error}</p>}

      <Section title="Your plan">
      {subs.length === 0 && (
        <ul>
          <li>Plan: {enterprise ? 'Enterprise (set by contract)' : plan === 'plus' ? 'Plus (included with your account)' : 'Free ($0)'}</li>
          {!enterprise && tier !== 'free' && <li>Developer tier: {tier}</li>}
        </ul>
      )}
      {subs.map((x) => {
        const m = summarize(x, pending)
        return (
          <ul key={x.id}>
            <li>Plan: {m.plan} ({m.price})</li>
            <li>Status: {m.status}</li>
            {m.when && <li>{m.when}</li>}
            {m.change && <li>{m.change}. You keep {m.plan} until then.</li>}
          </ul>
        )
      })}
      {pastDue && (
        <p role="alert">
          Your last payment failed. Paid limits continue until {longDate(license.graceEndsAt!)} ({PAST_DUE_GRACE_DAYS} days after the first failure), then the
          account returns to Free limits. Update your payment method in Manage billing. Your data, avatars, and profile are never deleted.
        </p>
      )}
      </Section>

      {!enabled && <p>{UNAVAILABLE}</p>}

      {target && held.has(target) && <p role="status">You are already on {PLAN_NAME[target]}.</p>}
      {target && !held.has(target) && canSwitchTo(target) && subs.length > 0 && <ConfirmSwitch target={target} subs={subs} endsOn={subs[0]!.currentPeriodEnd} />}

      <Section title="Plans">
      <ul>
        {PRICING.map((p) => {
          const id = p.id
          const isCurrent = id === 'free' ? subs.length === 0 && !enterprise && plan !== 'plus' : held.has(id) || (id === 'plus' && plan === 'plus' && subs.length === 0)
          return (
            <li key={id}>
              <strong>{p.name}</strong>: {p.amount === 0 ? '$0' : `${formatPrice(p.amount)} per ${p.per === 'mo' ? 'month' : p.per}`}
              {isCurrent && ' (current)'}
              {id !== 'free' && !isCurrent && canSwitchTo(id) && subs.length === 0 && (
                <form action={startCheckout} style={{ display: 'inline', marginLeft: 12 }}>
                  <input type="hidden" name="tier" value={id} />
                  <Button type="submit" variant="primary">Subscribe to {p.name}</Button>
                </form>
              )}
              {id !== 'free' && !isCurrent && canSwitchTo(id) && subs.length > 0 && !pending && (
                <a href={`/account/billing?change=${id}`} style={{ marginLeft: 12 }}>
                  Switch to {p.name}
                </a>
              )}
            </li>
          )
        })}
      </ul>
      {subs.length > 0 && <p>To go back to Free, cancel your subscription below. You keep your paid plan until the end of the period you paid for.</p>}
      <p>Prices exclude tax. Stripe Tax adds any sales tax or VAT at checkout based on your billing address.</p>
      </Section>
      <Section title="How changes work">
      <ul>
        <li>Upgrades apply now, and you are charged the difference for the rest of the period.</li>
        <li>Downgrades apply at the end of the current period. You keep your plan until then.</li>
        <li>Cancellations end at the end of the period you paid for.</li>
        <li>Partial periods are not refunded.</li>
      </ul>
      </Section>

      {enabled && pending && (
        <Section title="Scheduled plan change">
          <form action={cancelPlanChange}>
            <p>Your plan changes to {PLAN_NAME[pending.tier]} on {longDate(pending.at)}. To keep {PLAN_NAME[subs[0]!.tier]}, cancel the scheduled change.</p>
            <Button type="submit">Cancel the scheduled change (keep {PLAN_NAME[subs[0]!.tier]})</Button>
          </form>
        </Section>
      )}

      {enabled && subs.map((x) => (
        <Section key={`manage-${x.id}`} title={`${PLAN_NAME[x.tier]} subscription`}>
          {x.cancelAtPeriodEnd ? (
            <form action={resumeSubscription}>
              <p>Your subscription is set to end. You can keep it any time before it ends.</p>
              <Button type="submit" variant="primary">Resume {PLAN_NAME[x.tier]}</Button>
            </form>
          ) : (
            <form action={cancelSubscription}>
              <p>Cancel any time. Your plan stays until the end of the period you paid for, and you are not charged again.</p>
              <Button type="submit" variant="danger">Cancel {PLAN_NAME[x.tier]} at the end of the period</Button>
            </form>
          )}
        </Section>
      ))}

      {enabled && (customer || subs.length > 0) && (
        <Section title="Payment method and invoices" intro="Update your card, see past invoices, and download receipts in the Stripe customer portal.">
          <form action={openPortal}>
            <Button type="submit">Manage billing</Button>
          </form>
        </Section>
      )}

      <LicenseUsage license={license} />
    </PageMain>
  )
}

/** Asks for confirmation before a plan switch, with the proration rule in plain words. */
function ConfirmSwitch({ target, subs, endsOn }: { target: PaidPlan; subs: Array<{ tier: PaidPlan }>; endsOn: Date | null }) {
  const name = PLAN_NAME[target]!
  const from = subs.length === 1 ? subs[0]!.tier : null
  const t = PRICING.find((p) => p.id === target)!
  const upgrade = from ? t.amount > (PRICING.find((p) => p.id === from)?.amount ?? 0) : true
  return (
    <Section title={`Switch to ${name}`}>
      <p>
        {name} is {formatPrice(t.amount)} per month, plus tax.{' '}
        {upgrade
          ? 'You are charged the difference for the rest of this period now, and the full price at each renewal. Your renewal date stays the same.'
          : `The change happens at the end of your current period${endsOn ? ` (${longDate(endsOn)})` : ''}. You keep your current plan until then, are not charged today, and get no credit or refund for the rest of the period.`}
      </p>
      <form action={switchPlan}>
        <input type="hidden" name="tier" value={target} />
        <Button type="submit" variant="primary">{upgrade ? `Confirm switch to ${name}` : `Schedule the change to ${name}`}</Button>{' '}
        <a href="/account/billing">Keep my current plan</a>
      </form>
    </Section>
  )
}

const dateOf = (d: Date) => d.toISOString().slice(0, 10)

/** Billing for an organization license. Owners only; the Stripe customer is the billing owner's. */
async function OrgBilling({ did, orgId, q }: { did: string; orgId: string; q: { checkout?: string; error?: string } }) {
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
