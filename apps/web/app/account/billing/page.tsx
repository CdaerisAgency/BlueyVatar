import { PAST_DUE_GRACE_DAYS, effectiveTier } from '@blueyvatar/core'
import { PageMain } from '../../../components/Page'
import { requireDid } from '../../../lib/auth'
import { billingEnabled, plusEnabled } from '../../../lib/billing/config'
import { getBillingStore } from '../../../lib/billing/store'
import { getDashboardStore } from '../../../lib/dashboard-store'
import { PRICING, formatPrice } from '../../../lib/pricing'
import { resolvePlan } from '../../../lib/plan'
import AccountNav from '../AccountNav'
import { openPortal, startCheckout } from './actions'

export const dynamic = 'force-dynamic'

const NOTICE: Record<string, string> = {
  success: 'Thanks. Your subscription is being set up. This page updates when Stripe confirms the payment, usually within a minute.',
  canceled: 'Checkout was canceled. You were not charged.',
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string; error?: string }> }) {
  const did = await requireDid('/account/billing')
  const q = await searchParams
  const license = await getDashboardStore().ensureLicense(did)
  const billing = getBillingStore()
  const [customer, sub, plusSub, plan] = await Promise.all([billing.customerFor(did), billing.subscriptionFor(did), billing.subscriptionFor(did, 'plus'), resolvePlan(did)])
  const enabled = billingEnabled()
  const plusOn = plusEnabled()
  const now = new Date()
  const tier = effectiveTier(license, now)
  const pastDue = license.status === 'past_due' && license.graceEndsAt
  const dateText = (d: Date) => d.toISOString().slice(0, 10)

  return (
    <PageMain>
      <AccountNav />
      <h1>Billing</h1>
      <p>Signed in as {did}</p>
      {q.checkout && NOTICE[q.checkout] && <p role="status">{NOTICE[q.checkout]}</p>}
      {q.error && <p role="alert">{q.error}</p>}

      <h2>Your plan</h2>
      <ul>
        <li>Plan: {plan === 'plus' ? 'Plus' : 'Free'}</li>
        <li>Developer tier: {tier}</li>
        {plusSub && <li>Plus subscription: {plusSub.status.replace('_', ' ')}{plusSub.currentPeriodEnd ? `, ${plusSub.cancelAtPeriodEnd ? 'ends' : 'renews'} ${dateText(plusSub.currentPeriodEnd)}` : ''}</li>}
        {sub && <li>Subscription: {sub.status.replace('_', ' ')}{sub.currentPeriodEnd ? `, ${sub.cancelAtPeriodEnd ? 'ends' : 'renews'} ${dateText(sub.currentPeriodEnd)}` : ''}</li>}
        {pastDue && (
          <li>
            Your last payment failed. Paid limits continue until {dateText(license.graceEndsAt!)} ({PAST_DUE_GRACE_DAYS} days after the first failure), then the
            account returns to Free limits. Update your payment method in Manage billing. Your data, avatars, and profile are never deleted.
          </li>
        )}
      </ul>

      {!enabled && <p>Billing is not available yet on this deployment.</p>}

      <h2>Plans</h2>
      <ul>
        {PRICING.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong>: {p.amount === 0 ? '$0' : `${formatPrice(p.amount)} per ${p.per === 'mo' ? 'month' : p.per}`}
            {(p.id === 'plus' ? plan === 'plus' : p.id === tier) && ' (current)'}
            {p.id === 'plus' && plusOn && !plusSub && plan !== 'plus' && (
              <form action={startCheckout} style={{ display: 'inline', marginLeft: 12 }}>
                <input type="hidden" name="tier" value="plus" />
                <button type="submit">Subscribe to Plus</button>
              </form>
            )}
            {enabled && p.id !== 'free' && p.id !== 'plus' && !sub && license.tier !== 'enterprise' && (
              <form action={startCheckout} style={{ display: 'inline', marginLeft: 12 }}>
                <input type="hidden" name="tier" value={p.id} />
                <button type="submit">Subscribe to {p.name}</button>
              </form>
            )}
          </li>
        ))}
      </ul>
      <p>Prices exclude tax. Stripe Tax adds any sales tax or VAT at checkout based on your billing address.</p>

      {enabled && (customer || sub || plusSub) && (
        <form action={openPortal}>
          <p>Update your card, switch plans, download invoices, or cancel in the Stripe customer portal.</p>
          <button type="submit">Manage billing</button>
        </form>
      )}
    </PageMain>
  )
}
