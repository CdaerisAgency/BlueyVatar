'use server'

import { redirect } from 'next/navigation'
import { clearSessionCookie, currentDid, oauthClient } from '../../../../lib/auth'
import { confirmationMatches, deleteAccountData, DeletionBlocked } from '../../../../lib/account-data'
import { attestationWriter } from '../../../../lib/attestation'
import { stripeClient } from '../../../../lib/billing/stripe'
import { purgeImagePrefixes } from '../../../../lib/cache-purge'
import { cfSaasConfig, deleteHostname } from '../../../../lib/cf-saas'
import { limited } from '../../../../lib/rate-guard'
import { getPool } from '../../../../lib/store'

const back = (error: string): never => redirect(`/account/settings/danger?error=${encodeURIComponent(error)}`)

/** Deletes everything except billing records, signs the person out, and shows what was kept. */
export async function deleteMyData(form: FormData): Promise<void> {
  const did = await currentDid()
  if (!did) return redirect('/login')
  const wait = await limited(['deleteData.did', 'deleteData.ip'], did)
  if (wait) return back(wait)
  if (!confirmationMatches(String(form.get('confirm') ?? ''))) return back('Type the confirmation phrase exactly to delete your data.')
  const pool = getPool()
  if (!pool) return back('Deleting data needs the database, which is not configured here.')
  const stripe = stripeClient()
  const cf = cfSaasConfig()
  try {
    await deleteAccountData(pool, did, {
      cancelSubscription: stripe ? async (id) => void (await stripe.subscriptions.cancel(id)) : undefined,
      deleteHostname: cf ? (id) => deleteHostname(cf, id) : undefined,
      removeAttestation: (uri) => attestationWriter().remove(uri),
      purgeImages: async (d, cids) => void (await purgeImagePrefixes(d, cids)),
    })
  } catch (err) {
    if (err instanceof DeletionBlocked) return back(err.message)
    console.error('account deletion failed', err instanceof Error ? err.message : 'unknown')
    return back('Something went wrong and your data was not deleted. Try again.')
  }
  await (await oauthClient()).revoke(did).catch(() => undefined)
  await clearSessionCookie()
  return redirect('/data-deleted')
}
