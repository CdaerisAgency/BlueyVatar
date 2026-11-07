import { REQUEST_ID_HEADER, requestIdFrom } from '@blueyvatar/core'
import { getBillingStore } from '../../../../lib/billing/store'
import { handleStripeWebhook } from '../../../../lib/billing/webhook'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Stripe webhook. The body is read as raw text because the signature covers the exact bytes. */
export async function POST(req: Request): Promise<Response> {
  const raw = await req.text()
  const r = await handleStripeWebhook(raw, req.headers.get('stripe-signature'), { store: getBillingStore() })
  const requestId = requestIdFrom(req.headers.get(REQUEST_ID_HEADER))
  const body = r.status >= 500 ? { ...r.body, request_id: requestId } : r.body
  return Response.json(body, { status: r.status, headers: { [REQUEST_ID_HEADER]: requestId } })
}
