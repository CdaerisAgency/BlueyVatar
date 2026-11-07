'use server'

import { PAID_PLANS, type PaidPlan } from '@blueyvatar/core'
import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { createCheckoutUrl, createPortalUrl, stripeClient, type UrlResult } from '../../../lib/billing/stripe'
import { getBillingStore } from '../../../lib/billing/store'
import { getDashboardStore } from '../../../lib/dashboard-store'
import { PUBLIC_URL } from '../../../lib/oauth'

async function ctx() {
  const did = await currentDid()
  if (!did) return redirect('/login')
  return { did, c: { store: getBillingStore(), client: stripeClient(), baseUrl: PUBLIC_URL.replace(/\/$/, '') } }
}

const back = (r: Extract<UrlResult, { ok: false }>): never => redirect(`/account/billing?error=${encodeURIComponent(r.error)}`)

/** Starts Stripe Checkout for Plus or a paid developer tier. Redirects to Stripe, or back with an error. */
export async function startCheckout(form: FormData): Promise<void> {
  const tier = String(form.get('tier') ?? '')
  if (!(PAID_PLANS as readonly string[]).includes(tier)) return back({ ok: false, error: 'Choose Plus, Pro, or Business.' })
  const { did, c } = await ctx()
  const license = await getDashboardStore().ensureLicense(did)
  if (tier !== 'plus' && license.tier === 'enterprise') return back({ ok: false, error: 'Enterprise licenses are managed by contract. Contact us to change it.' })
  const r = await createCheckoutUrl(c, did, license.licenseId, tier as PaidPlan)
  return r.ok ? redirect(r.url) : back(r)
}

/** Opens the Stripe Customer Portal to update payment methods, change plan, view invoices, or cancel. */
export async function openPortal(): Promise<void> {
  const { did, c } = await ctx()
  const r = await createPortalUrl(c, did)
  return r.ok ? redirect(r.url) : back(r)
}
