import { getBillingStore } from '../../../../lib/billing/store'
import { handleStripeWebhook } from '../../../../lib/billing/webhook'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Stripe webhook. The body is read as raw text because the signature covers the exact bytes. */
export async function POST(req: Request): Promise<Response> {
  const raw = await req.text()
  const r = await handleStripeWebhook(raw, req.headers.get('stripe-signature'), { store: getBillingStore() })
  return Response.json(r.body, { status: r.status })
}
