import type pg from 'pg'
import { maskEmail } from './mask'
import { decryptJson } from './token-crypto'
import { releaseAllPg } from './store'

/** Stripe billing rows are kept this long after a user deletes their data (owner decision on issue #140). */
export const BILLING_RETENTION_YEARS = 7

/** The phrase a person types to confirm deletion. */
export const DELETE_CONFIRMATION = 'delete my data'

export const confirmationMatches = (typed: string): boolean => typed.trim().toLowerCase() === DELETE_CONFIRMATION

type Q = Pick<pg.Pool, 'query'>
const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : d == null ? null : String(d))

/**
 * Everything blueyvatar holds about one DID, as plain JSON. Never includes key hashes or secrets, the stored
 * primary email beyond a masked form, or reports filed against the DID. Billing rows are included as a summary.
 */
export async function exportAccountData(pool: Q, did: string, now: Date = new Date(), decrypt: (enc: string) => string = (e) => decryptJson<string>(e)) {
  const q = async (sql: string, params: unknown[] = [did]) => (await pool.query(sql, params)).rows as Record<string, unknown>[]
  const [links, holds, notice, profileLinks, claims, attestations, rules, licenses, keys, domains, customers, subs, images, profile] = await Promise.all([
    q('SELECT email_hash, method, is_primary, email_domain, verified_at FROM email_links WHERE did = $1 ORDER BY is_primary DESC, verified_at, email_hash'),
    q('SELECT email_hash, reason, released_at FROM email_holds WHERE did = $1 ORDER BY released_at'),
    q('SELECT email_enc FROM notice_emails WHERE did = $1'),
    q('SELECT rkey, url, title, created_at FROM profile_links WHERE did = $1 ORDER BY created_at, rkey'),
    q('SELECT rkey, platform, uri, record, indexed_at FROM claims WHERE did = $1 ORDER BY rkey'),
    q('SELECT uri, claim_rkey, result, method, created_at FROM attestations WHERE claim_did = $1 ORDER BY created_at'),
    q('SELECT keyed_only, domain_allowlist, hidden_profile, email_lookup_opt_out, updated_at FROM visibility_rules WHERE did = $1'),
    q('SELECT license_id, tier, status, term, attribution_required, entitlements, grace_ends_at, created_at FROM licenses WHERE owner = $1 ORDER BY created_at'),
    q('SELECT k.prefix, k.kind, k.label, k.domains, k.created_at, k.revoked_at FROM api_keys k JOIN licenses l ON l.license_id = k.license_id WHERE l.owner = $1 ORDER BY k.created_at'),
    q('SELECT hostname, status, created_at, verified_at FROM custom_domains WHERE did = $1'),
    q('SELECT stripe_customer_id, created_at FROM billing_customers WHERE did = $1'),
    q('SELECT stripe_subscription_id, tier, status, current_period_end, cancel_at_period_end, deleted_at FROM subscriptions WHERE did = $1 ORDER BY stripe_subscription_id'),
    q('SELECT rkey, cid, mime_type, rating, is_default, license, created_at FROM images WHERE did = $1 ORDER BY created_at, rkey'),
    q('SELECT record FROM profiles WHERE did = $1'),
  ])
  let primaryEmail: string | null = null
  if (notice[0]) {
    try {
      primaryEmail = maskEmail(decrypt(String(notice[0].email_enc)))
    } catch {
      primaryEmail = null
    }
  }
  const dates = <T extends Record<string, unknown>>(rows: T[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? iso(v) : v])))
  return {
    exportedAt: now.toISOString(),
    did,
    note: 'Records in your own atproto repository (avatars, profile, claims, links, gallery) are stored by your PDS and are not part of this file.',
    emails: { primaryMasked: primaryEmail, links: dates(links), holds: dates(holds) },
    profileLinks: dates(profileLinks),
    claims: dates(claims),
    attestations: dates(attestations),
    visibilityRules: dates(rules)[0] ?? null,
    licenses: dates(licenses),
    apiKeys: dates(keys),
    customDomain: dates(domains)[0] ?? null,
    billing: { customers: dates(customers), subscriptions: dates(subs) },
    indexed: { images: dates(images), profile: profile[0]?.record ?? null },
  }
}

export type DeleteDeps = {
  /** Cancels a Stripe subscription at once. A throw stops the deletion before anything is removed. */
  cancelSubscription?: (stripeSubscriptionId: string) => Promise<void>
  /** Removes the Cloudflare for SaaS hostname. A throw stops the deletion. */
  deleteHostname?: (cfId: string) => Promise<void>
  /** Removes an attestation record from the service repo. Best effort, after the database commit. */
  removeAttestation?: (uri: string) => Promise<void>
  /** Purges cached image URLs for the DID. Best effort, after the database commit. */
  purgeImages?: (did: string, cids: string[]) => Promise<void>
}

export class DeletionBlocked extends Error {}

export type DeleteSummary = { emailLinksHeld: number; images: number; claims: number; subscriptionsCanceled: number }

/**
 * Deletes everything blueyvatar holds for the DID except Stripe billing rows, which are marked `deleted_at` so the
 * retention job can remove them 7 years later. Email links become 30-day holds through the same statements the indexer
 * runs when Tap reports an account as deleted. `oauth_state` has no DID column (the value is encrypted and expires
 * within an hour), so it is not touched here.
 */
export async function deleteAccountData(pool: pg.Pool, did: string, deps: DeleteDeps = {}): Promise<DeleteSummary> {
  const rows = async (sql: string) => (await pool.query(sql, [did])).rows as Record<string, string>[]

  // Outside the transaction: external systems first, so a failure leaves the account whole and the user can retry.
  const live = await rows("SELECT stripe_subscription_id AS id FROM subscriptions WHERE did = $1 AND status NOT IN ('canceled', 'incomplete_expired')")
  try {
    for (const s of live) await deps.cancelSubscription?.(s.id!)
  } catch {
    throw new DeletionBlocked('Could not cancel your subscription with Stripe. Nothing was deleted. Try again, or cancel it from Manage billing first.')
  }
  const domain = (await rows('SELECT cf_id FROM custom_domains WHERE did = $1'))[0]
  try {
    if (domain) await deps.deleteHostname?.(domain.cf_id!)
  } catch {
    throw new DeletionBlocked('Could not remove your custom domain from Cloudflare. Nothing else was deleted. Try again later.')
  }
  const cids = (await rows('SELECT DISTINCT cid FROM images WHERE did = $1')).map((r) => r.cid!)
  const uris = (await rows("SELECT uri FROM attestations WHERE claim_did = $1 AND result <> 'revoked'")).map((r) => r.uri!)

  const c = await pool.connect()
  let summary: DeleteSummary
  try {
    await c.query('BEGIN')
    const emailLinksHeld = await releaseAllPg(c, did)
    await c.query('DELETE FROM oauth_session WHERE sub = $1', [did])
    await c.query('DELETE FROM profile_links WHERE did = $1', [did])
    await c.query('DELETE FROM visibility_rules WHERE did = $1', [did])
    await c.query('DELETE FROM verification_state WHERE did = $1', [did])
    await c.query('DELETE FROM custom_domains WHERE did = $1', [did])
    const images = await c.query('DELETE FROM images WHERE did = $1', [did])
    await c.query('DELETE FROM profiles WHERE did = $1', [did])
    const claims = await c.query('DELETE FROM claims WHERE did = $1', [did])
    await c.query('DELETE FROM attestations WHERE claim_did = $1', [did])
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`license:${did}`])
    // Cascades to api_keys, usage_counters, and usage_alerts. Billing rows no longer depend on the license (migration 0019).
    await c.query('DELETE FROM licenses WHERE owner = $1', [did])
    await c.query('UPDATE billing_customers SET deleted_at = coalesce(deleted_at, now()) WHERE did = $1', [did])
    await c.query("UPDATE subscriptions SET deleted_at = coalesce(deleted_at, now()), status = CASE WHEN status = 'incomplete' THEN 'incomplete_expired' ELSE 'canceled' END WHERE did = $1", [did])
    await c.query('COMMIT')
    summary = { emailLinksHeld, images: images.rowCount ?? 0, claims: claims.rowCount ?? 0, subscriptionsCanceled: live.length }
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    c.release()
  }

  for (const uri of uris) await deps.removeAttestation?.(uri).catch((e) => console.error('attestation remove failed', e instanceof Error ? e.message : 'unknown'))
  if (cids.length) await deps.purgeImages?.(did, cids).catch((e) => console.error('image purge failed', e instanceof Error ? e.message : 'unknown'))
  return summary
}
