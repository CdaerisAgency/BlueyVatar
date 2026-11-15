'use server'

import { revalidatePath } from 'next/cache'
import { currentDid } from '../auth'
import { resolvePlan } from '../plan'
import { getPool } from '../store'
import { dismissOffer } from './grants'

/** Hides the offer banner for the signed-in account. The offer itself stays available on the effects page. */
export async function dismissOfferBanner(form: FormData): Promise<void> {
  const did = await currentDid()
  const pool = getPool()
  const id = Number(form.get('offer'))
  if (!did || !pool || !Number.isSafeInteger(id)) return
  await dismissOffer(pool, did, await resolvePlan(did), id)
  revalidatePath('/account', 'layout')
}
