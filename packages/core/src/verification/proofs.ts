/**
 * Public-proof verification that needs no platform app (docs/research/verified-accounts-v1.md):
 *   - dns-txt: a TXT record on `_blueyvatar.<domain>` holding the proof string.
 *   - bsky-proof: the Bluesky account is the signed-in account itself, or its public bio holds the proof string.
 * The proof string names the DID, so a proof placed for one account does not verify another.
 */
import { resolveTxt } from 'node:dns/promises'
import type { Fetcher } from './safe-fetch.js'
import type { VerifyOutcome } from './verify.js'

export const PROOF_PREFIX = 'blueyvatar-verify='
export const DNS_PROOF_LABEL = '_blueyvatar'
export const BSKY_PUBLIC_API = 'https://public.api.bsky.app'

export const proofToken = (did: string): string => `${PROOF_PREFIX}${did}`

export type TxtResolver = (name: string) => Promise<string[][]>
const systemTxt: TxtResolver = (name) => resolveTxt(name)

const transient = (reason: string): VerifyOutcome => ({ ok: false, reason, transient: true })

/** The DNS name where the proof record goes for a claim uri like https://example.com. */
export function dnsProofName(claimUri: string): string | null {
  try {
    const host = new URL(claimUri).hostname.toLowerCase()
    return host ? `${DNS_PROOF_LABEL}.${host}` : null
  } catch {
    return null
  }
}

/** The domain must publish a TXT record on `_blueyvatar.<domain>` whose value is the DID's proof string. */
export async function verifyDnsTxt(claimUri: string, did: string, resolve: TxtResolver = systemTxt): Promise<VerifyOutcome> {
  const name = dnsProofName(claimUri)
  if (!name) return { ok: false, reason: 'The claim address is not a domain.' }
  const want = proofToken(did)
  try {
    const records = await resolve(name)
    // A long TXT value arrives as several strings that concatenate.
    return records.some((r) => r.join('').trim() === want)
      ? { ok: true }
      : { ok: false, reason: `No TXT record on ${name} holds ${want}.` }
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'ENOTFOUND' || code === 'ENODATA') return { ok: false, reason: `No TXT record was found on ${name}.` }
    return transient('The DNS lookup did not complete.')
  }
}

/** The handle or DID in a https://bsky.app/profile/<actor> claim uri. */
export function bskyActor(claimUri: string): string | null {
  try {
    const u = new URL(claimUri)
    const m = /^\/profile\/([^/]+)\/?$/.exec(u.pathname)
    return u.hostname === 'bsky.app' && m ? decodeURIComponent(m[1] ?? '') : null
  } catch {
    return null
  }
}

/**
 * Reads the public profile (no sign-in, per the AppView's public endpoint). It passes when the account's DID
 * is the signed-in user's DID, or when the bio contains the proof string.
 */
export async function verifyBluesky(claimUri: string, did: string, f: Fetcher): Promise<VerifyOutcome & { via?: 'identity' | 'bio' }> {
  const actor = bskyActor(claimUri)
  if (!actor) return { ok: false, reason: 'The claim address is not a Bluesky profile.' }
  try {
    const r = await f(`${BSKY_PUBLIC_API}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`, { headers: { accept: 'application/json' }, maxBytes: 500_000 })
    if (r.status === 400 || r.status === 404) return { ok: false, reason: 'That Bluesky account was not found.' }
    if (r.status !== 200) return transient(`Bluesky answered with status ${r.status}.`)
    let p: { did?: unknown; description?: unknown }
    try { p = JSON.parse(r.text) as typeof p } catch { return transient('Bluesky returned an unreadable answer.') }
    if (typeof p.did === 'string' && p.did === did) return { ok: true, via: 'identity' }
    const want = proofToken(did)
    if (typeof p.description === 'string' && p.description.includes(want)) return { ok: true, via: 'bio' }
    return { ok: false, reason: `Add ${want} to that account's bio, then check again.` }
  } catch {
    return transient('Bluesky could not be reached.')
  }
}
