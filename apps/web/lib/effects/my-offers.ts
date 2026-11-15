import { resolvePlan } from '../plan'
import { getPool } from '../store'
import { offersFor, type MyOffer } from './grants'

/** Live offers for one account. Empty without a database (local dev) or when the lookup fails, so a page never breaks on it. */
export async function myOffers(did: string): Promise<MyOffer[]> {
  const pool = getPool()
  if (!pool) return []
  try {
    return await offersFor(pool, did, await resolvePlan(did))
  } catch {
    return []
  }
}
