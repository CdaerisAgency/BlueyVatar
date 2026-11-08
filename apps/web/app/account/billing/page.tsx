import { PAID_PLANS, PAST_DUE_GRACE_DAYS, effectiveTier, type PaidPlan } from '@blueyvatar/core'
import { PageMain } from '../../../components/Page'
import { requireDid } from '../../../lib/auth'
import { billingEnabled, planEnabled } from '../../../lib/billing/config'
import { longDate, summarize } from '../../../lib/billing/summary'
import { getBillingStore } from '../../../lib/billing/store'
import { getDashboardStore } from '../../../lib/dashboard-store'
import { resolvePlan } from '../../../lib/plan'
import { PRICING, formatPrice } from '../../../lib/pricing'
import { canManageBilling } from '../../../lib/orgs/roles'
import { getOrganization, memberRole, orgLicense } from '../../../lib/orgs/store'
import { getPool } from '../../../lib/store'
import { cancelSubscription, openPortal, resumeSubscription, startCheckout, switchPlan } from './actions'

export const dynamic = 'force-dynamic'

const NOTICE: Record<string, string> = {
  success: 'Thanks. Your subscription is being set up. This page updates when Stripe confirms the payment, usually within a minute.',
  canceled: 'Checkout was canceled. You were not charged.',
}

const UNAVAILABLE = 'Billing is not available yet on this deployment. To change your plan now, email support@blueyvatar.com.'
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
  const enterprise = license.tier === 'enterprise'
  // The tier names a person currently holds, for the "(current)" marker. Enterprise is a contract and has no row on the list.
  const held = new Set<string>(subs.map((x) => x.tier))
  const target = q.change && (PAID_PLANS as readonly string[]).includes(q.change) ? (q.change as PaidPlan) : null
  const canSwitchTo = (id: PaidPlan) => planEnabled(id) && !enterprise

  return (
    <PageMain>
      <h1>Plan and billing</h1>
      <p>Signed in as {did}</p>
      {q.checkout && NOTICE[q.checkout] && <p role="status">{NOTICE[q.checkout]}</p>}
      {q.done && <p role="status">{q.done}</p>}
      {q.error && <p role="alert">{q.error}</p>}

      <h2>Your plan</h2>
      {subs.length === 0 && (
        <ul>
          <li>Plan: {enterprise ? 'Enterprise (set by contract)' : plan === 'plus' ? 'Plus (included with your account)' : 'Free ($0)'}</li>
          {!enterprise && tier !== 'free' && <li>Developer tier: {tier}</li>}
        </ul>
      )}
      {subs.map((x) => {
        const m = summarize(x)
        return (
          <ul key={x.id}>
            <li>Plan: {m.plan} ({m.price})</li>
            <li>Status: {m.status}</li>
            {m.when && <li>{m.when}</li>}
          </ul>
        )
      })}
      {pastDue && (
        <p role="alert">
          Your last payment failed. Paid limits continue until {longDate(license.graceEndsAt!)} ({PAST_DUE_GRACE_DAYS} days after the first failure), then the
          account returns to Free limits. Update your payment method in Manage billing. Your data, avatars, and profile are never deleted.
        </p>
      )}

      {!enabled && <p>{UNAVAILABLE}</p>}

      {target && held.has(target) && <p role="status">You are already on {PLAN_NAME[target]}.</p>}
      {target && !held.has(target) && canSwitchTo(target) && subs.length > 0 && <ConfirmSwitch target={target} subs={subs} />}

      <h2>Plans</h2>
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
                  <button type="submit">Subscribe to {p.name}</button>
                </form>
              )}
              {id !== 'free' && !isCurrent && canSwitchTo(id) && subs.length > 0 && (
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

      {enabled && subs.map((x) => (
        <section key={`manage-${x.id}`}>
          <h2>{PLAN_NAME[x.tier]} subscription</h2>
          {x.cancelAtPeriodEnd ? (
            <form action={resumeSubscription}>
              <p>Your subscription is set to end. You can keep it any time before it ends.</p>
              <button type="submit">Resume {PLAN_NAME[x.tier]}</button>
            </form>
          ) : (
            <form action={cancelSubscription}>
              <p>Cancel any time. Your plan stays until the end of the period you paid for, and you are not charged again.</p>
              <button type="submit">Cancel {PLAN_NAME[x.tier]} at the end of the period</button>
            </form>
          )}
        </section>
      ))}

      {enabled && (customer || subs.length > 0) && (
        <form action={openPortal}>
          <h2>Payment method and invoices</h2>
          <p>Update your card, see past invoices, and download receipts in the Stripe customer portal.</p>
          <button type="submit">Manage billing</button>
        </form>
      )}
    </PageMain>
  )
}

/** Asks for confirmation before a plan switch, with the proration rule in plain words. */
function ConfirmSwitch({ target, subs }: { target: PaidPlan; subs: Array<{ tier: PaidPlan }> }) {
  const name = PLAN_NAME[target]!
  const from = subs.length === 1 ? subs[0]!.tier : null
  const t = PRICING.find((p) => p.id === target)!
  const upgrade = from ? t.amount > (PRICING.find((p) => p.id === from)?.amount ?? 0) : true
  return (
    <section aria-label={`Switch to ${name}`}>
      <h2>Switch to {name}</h2>
      <p>
        {name} is {formatPrice(t.amount)} per month, plus tax.{' '}
        {upgrade
          ? 'You are charged the difference for the rest of this period now, and the full price at each renewal.'
          : 'You get a credit for the unused part of your current plan. It is applied to your next invoice, not refunded to your card.'}{' '}
        Your renewal date stays the same.
      </p>
      <form action={switchPlan}>
        <input type="hidden" name="tier" value={target} />
        <button type="submit">Confirm switch to {name}</button>
        <a href="/account/billing" style={{ marginLeft: 12 }}>Keep my current plan</a>
      </form>
    </section>
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
        <h1>Plan and billing</h1>
        <p role="alert">You are not a member of that organization.</p>
      </PageMain>
    )
  }
  if (!canManageBilling(role)) {
    return (
      <PageMain>
        <h1>Plan and billing: {org.name}</h1>
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
      <h1>Plan and billing: {org.name}</h1>
      <p>Signed in as {did}</p>
      {q.checkout && NOTICE[q.checkout] && <p role="status">{NOTICE[q.checkout]}</p>}
      {q.error && <p role="alert">{q.error}</p>}
      <p>Billing for this organization stays with its billing owner, {lic.billingDid}. Any owner can start or manage the subscription.</p>
      <ul>
        <li>Developer tier: {license?.tier ?? 'free'}</li>
        {sub && <li>Subscription: {sub.status.replace('_', ' ')}{sub.currentPeriodEnd ? `, ${sub.cancelAtPeriodEnd ? 'ends' : 'renews'} ${dateOf(sub.currentPeriodEnd)}` : ''}</li>}
      </ul>
      {!enabled && <p>{UNAVAILABLE}</p>}
      {enabled && !sub && business && (
        <form action={startCheckout}>
          <input type="hidden" name="tier" value="business" />
          <input type="hidden" name="org" value={orgId} />
          <button type="submit">Subscribe to Business ({formatPrice(business.amount)} per month)</button>
        </form>
      )}
      {enabled && sub && (
        <form action={openPortal}>
          <input type="hidden" name="org" value={orgId} />
          <button type="submit">Manage billing</button>
        </form>
      )}
      <p>Prices exclude tax. Stripe Tax adds any sales tax or VAT at checkout.</p>
    </PageMain>
  )
}
