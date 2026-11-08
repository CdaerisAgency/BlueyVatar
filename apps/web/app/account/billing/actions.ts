'use server'

import { PAID_PLANS, type PaidPlan } from '@blueyvatar/core'
import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { changePlan, createCheckoutUrl, createPortalUrl, setCancelAtPeriodEnd, stripeClient, type ActionResult, type UrlResult } from '../../../lib/billing/stripe'
import { getBillingStore } from '../../../lib/billing/store'
import { getDashboardStore } from '../../../lib/dashboard-store'
import { PUBLIC_URL } from '../../../lib/oauth'
import { canManageBilling } from '../../../lib/orgs/roles'
import { memberRole, orgLicense } from '../../../lib/orgs/store'
import { getPool } from '../../../lib/store'

async function ctx() {
  const did = await currentDid()
  if (!did) return redirect('/login')
  return { did, c: { store: getBillingStore(), client: stripeClient(), baseUrl: PUBLIC_URL.replace(/\/$/, '') } }
}

const backTo = (org: string | null) => (org ? `/account/billing?org=${encodeURIComponent(org)}&` : '/account/billing?')
const back = (r: Extract<UrlResult, { ok: false }>, org: string | null = null): never => redirect(`${backTo(org)}error=${encodeURIComponent(r.error)}`)

/**
 * For an organization, billing stays with the org owner: only owners may act, and Checkout and the portal run as the
 * license's billing owner DID, who holds the Stripe customer. Returns the license and the DID that pays.
 */
async function orgBilling(did: string, orgId: string): Promise<{ ok: true; licenseId: string; payer: string } | { ok: false; error: string }> {
  const pool = getPool()
  if (!pool) return { ok: false, error: 'Organizations need the database, which is not configured here.' }
  if (!canManageBilling(await memberRole(pool, orgId, did))) return { ok: false, error: 'Only organization owners can manage billing.' }
  const lic = await orgLicense(pool, orgId)
  return lic ? { ok: true, licenseId: lic.licenseId, payer: lic.billingDid } : { ok: false, error: 'Organization not found.' }
}

/** Starts Stripe Checkout for Plus or a paid developer tier. Redirects to Stripe, or back with an error. */
export async function startCheckout(form: FormData): Promise<void> {
  const tier = String(form.get('tier') ?? '')
  const org = String(form.get('org') ?? '') || null
  if (!(PAID_PLANS as readonly string[]).includes(tier)) return back({ ok: false, error: 'Choose Plus, Pro, or Business.' }, org)
  const { did, c } = await ctx()
  if (org) {
    if (tier !== 'business') return back({ ok: false, error: 'Organizations subscribe to Business.' }, org)
    const o = await orgBilling(did, org)
    if (!o.ok) return back({ ok: false, error: o.error }, org)
    const r = await createCheckoutUrl(c, o.payer, o.licenseId, 'business')
    return r.ok ? redirect(r.url) : back(r, org)
  }
  const license = await getDashboardStore().ensureLicense(did)
  if (tier !== 'plus' && license.tier === 'enterprise') return back({ ok: false, error: 'Enterprise licenses are managed by contract. Contact us to change it.' })
  // Someone who already pays changes plan instead of buying a second subscription. The Billing page asks them to confirm first.
  const store = getBillingStore()
  if ((await store.subscriptionFor(did, 'developer', license.licenseId)) || (await store.subscriptionFor(did, 'plus'))) return redirect(`/account/billing?change=${tier}`)
  const r = await createCheckoutUrl(c, did, license.licenseId, tier as PaidPlan)
  return r.ok ? redirect(r.url) : back(r)
}

/** Opens the Stripe Customer Portal to update payment methods, change plan, view invoices, or cancel. */
export async function openPortal(form?: FormData): Promise<void> {
  const org = String(form?.get('org') ?? '') || null
  const { did, c } = await ctx()
  let payer = did
  if (org) {
    const o = await orgBilling(did, org)
    if (!o.ok) return back({ ok: false, error: o.error }, org)
    payer = o.payer
  }
  const r = await createPortalUrl(c, payer)
  return r.ok ? redirect(r.url) : back(r, org)
}

const done = (r: ActionResult): never => redirect(`/account/billing?${r.ok ? `done=${encodeURIComponent(r.message)}` : `error=${encodeURIComponent(r.error)}`}`)

/** Switches the signed-in person's own subscription to Plus, Pro, or Business. Personal billing only. */
export async function switchPlan(form: FormData): Promise<void> {
  const tier = String(form.get('tier') ?? '')
  if (!(PAID_PLANS as readonly string[]).includes(tier)) return back({ ok: false, error: 'Choose Plus, Pro, or Business.' })
  const { did, c } = await ctx()
  const license = await getDashboardStore().ensureLicense(did)
  if (tier !== 'plus' && license.tier === 'enterprise') return back({ ok: false, error: 'Enterprise licenses are managed by contract. Contact us to change it.' })
  return done(await changePlan(c, did, license.licenseId, tier as PaidPlan))
}

/** Ends the person's subscription at the close of the paid period. */
export async function cancelSubscription(form: FormData): Promise<void> {
  const { did, c } = await ctx()
  const license = await getDashboardStore().ensureLicense(did)
  return done(await setCancelAtPeriodEnd(c, did, license.licenseId, form.get('kind') === 'plus' ? 'plus' : 'developer', true))
}

/** Undoes a pending cancellation before the period ends. */
export async function resumeSubscription(form: FormData): Promise<void> {
  const { did, c } = await ctx()
  const license = await getDashboardStore().ensureLicense(did)
  return done(await setCancelAtPeriodEnd(c, did, license.licenseId, form.get('kind') === 'plus' ? 'plus' : 'developer', false))
}
