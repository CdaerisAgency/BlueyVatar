import type { OAuthSession } from '@atproto/oauth-client-node'
import { attestationWriter } from './attestation'
import { getClaimStore } from './claim-store'
import { deleteClaim, type StoredClaim } from './claims-repo'

const cooldowns = new Map<string, number>()

/** True when the key was used within `ms`. Bounds how often one claim can trigger an outbound fetch. */
export function coolingDown(key: string, ms: number, now = Date.now()): boolean {
  const last = cooldowns.get(key)
  if (last !== undefined && now - last < ms) return true
  cooldowns.set(key, now)
  if (cooldowns.size > 5000) for (const [k, t] of cooldowns) if (now - t > ms) cooldowns.delete(k)
  return false
}

/**
 * Records a successful verification: writes the attestation (to the service repo when configured),
 * stores the row with its method and result, and retires any earlier attestation for the claim.
 */
export async function attestVerified(did: string, claim: StoredClaim, method: string): Promise<void> {
  const store = getClaimStore()
  const writer = attestationWriter()
  await store.upsertClaim(did, claim.rkey, claim.value)
  const ref = await writer.write({ subject: { uri: claim.uri, cid: claim.cid }, result: 'verified', method })
  let superseded: string[]
  try {
    superseded = await store.recordVerified({
      uri: ref.uri, cid: ref.cid, claimDid: did, claimRkey: claim.rkey, claimCid: claim.cid, claimUri: claim.value.uri,
      result: 'verified', method, createdAt: new Date(),
    })
  } catch (err) {
    await writer.remove(ref.uri).catch(() => undefined)
    throw err
  }
  for (const uri of superseded) await writer.remove(uri).catch((e) => console.error('attestation remove failed', e instanceof Error ? e.message : 'unknown'))
}

/** Deletes the claim from the user's repo and the index, and removes its attestations everywhere. */
export async function removeClaim(session: OAuthSession, rkey: string): Promise<void> {
  const store = getClaimStore()
  const writer = attestationWriter()
  await deleteClaim(session, rkey)
  const uris = await store.revokeForClaim(session.did, rkey)
  await store.deleteClaim(session.did, rkey)
  for (const uri of uris) await writer.remove(uri).catch((e) => console.error('attestation remove failed', e instanceof Error ? e.message : 'unknown'))
}
