import { getBillingStore, type BillingStore } from './billing/store'
import { planFor, type Plan } from './records'

/**
 * The user plan in effect (spec section 11.2). Plus comes from either a manual grant (a DID in the PLUS_DIDS env var,
 * kept for testing and gifts) or a Plus subscription that still entitles at `now`. Everyone else is Free.
 * `planFor` in ./records stays the synchronous manual-grant check.
 */
export async function resolvePlan(did: string, store: Pick<BillingStore, 'hasPlus'> = getBillingStore(), now: Date = new Date()): Promise<Plan> {
  if (planFor(did) === 'plus') return 'plus'
  return (await store.hasPlus(did, now)) ? 'plus' : 'free'
}
