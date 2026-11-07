'use server'

import { randomBytes } from 'node:crypto'
import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { getClaimStore } from '../../../lib/claim-store'
import { MAX_CLAIMS, PLATFORM_LABELS, isOAuthProvider, isPlatform, normalizeClaim, parseMastodonUri, profileLinkFor, providerAuthorizeUrl, providerConfig, verifyBluesky, verifyDnsTxt, type ClaimRecord } from '../../../lib/claims'
import { methodFor, platformAvailable } from '../../../lib/claim-providers'
import { createClaim, getClaim, listClaims, putClaim, repoHandle } from '../../../lib/claims-repo'
import { githubAuthorizeUrl, githubConfig } from '../../../lib/github-oauth'
import { authorizeUrl, registerApp } from '../../../lib/mastodon-oauth'
import { PUBLIC_URL } from '../../../lib/oauth'
import { RepoError, repoSession } from '../../../lib/repo'
import { safeFetch } from '../../../lib/safe-fetch'
import { verifyRelMe } from '../../../lib/verify'
import { attestVerified, coolingDown, removeClaim } from '../../../lib/verification-service'

const CALLBACK_PATH = '/account/claims/callback'
const back = (key: 'error' | 'done', value: string): never => redirect(`/account/claims?${key}=${encodeURIComponent(value)}`)
const message = (err: unknown) => (err instanceof RepoError ? err.message : 'Something went wrong. Try again.')

export async function addClaim(form: FormData): Promise<void> {
  const did = (await currentDid()) ?? redirect('/login')
  const checked = normalizeClaim(String(form.get('platform') ?? ''), String(form.get('account') ?? ''))
  if (!checked.ok) return back('error', checked.error)
  if (!platformAvailable(checked.value.platform)) return back('error', `${PLATFORM_LABELS[checked.value.platform]} verification is not available yet.`)
  try {
    const session = await repoSession(did)
    const existing = await listClaims(session)
    if (existing.length >= MAX_CLAIMS) return back('error', `You can keep up to ${MAX_CLAIMS} claims. Delete one first.`)
    if (existing.some((c) => c.value.uri === checked.value.uri)) return back('error', 'You already added that account.')
    const record: ClaimRecord = { ...checked.value, createdAt: new Date().toISOString() }
    const ref = await createClaim(session, record)
    await getClaimStore().upsertClaim(did, ref.uri.slice(ref.uri.lastIndexOf('/') + 1), record)
  } catch (err) {
    console.error('claim add failed', err instanceof Error ? err.message : 'unknown')
    return back('error', message(err))
  }
  return back('done', 'Claim added. Run verification to show it on your profile.')
}

export async function deleteClaimAction(form: FormData): Promise<void> {
  const did = (await currentDid()) ?? redirect('/login')
  try {
    await removeClaim(await repoSession(did), String(form.get('rkey') ?? ''))
  } catch (err) {
    console.error('claim delete failed', err instanceof Error ? err.message : 'unknown')
    return back('error', message(err))
  }
  return back('done', 'Claim deleted and its attestation removed.')
}

export async function setHidden(form: FormData): Promise<void> {
  const did = (await currentDid()) ?? redirect('/login')
  const hidden = form.get('hidden') === 'true'
  try {
    const session = await repoSession(did)
    const claim = await getClaim(session, String(form.get('rkey') ?? ''))
    if (!claim) return back('error', 'That claim no longer exists.')
    const value: ClaimRecord = { ...claim.value, hidden }
    await putClaim(session, claim.rkey, value, claim.cid)
    await getClaimStore().upsertClaim(did, claim.rkey, value)
  } catch (err) {
    console.error('claim hide failed', err instanceof Error ? err.message : 'unknown')
    return back('error', message(err))
  }
  return back('done', hidden ? 'Hidden from hovercards.' : 'Shown in hovercards.')
}

/** Starts the right verification for the claim. OAuth methods redirect away; rel="me" answers at once. */
export async function verifyClaim(form: FormData): Promise<void> {
  const did = (await currentDid()) ?? redirect('/login')
  const rkey = String(form.get('rkey') ?? '')
  let target: string
  try {
    const session = await repoSession(did)
    const claim = await getClaim(session, rkey)
    if (!claim) return back('error', 'That claim no longer exists.')
    // The stored record must still be a canonical claim, whatever was written to the repo directly.
    const norm = isPlatform(claim.value.platform) ? normalizeClaim(claim.value.platform, claim.value.uri) : null
    if (!norm?.ok || norm.value.uri !== claim.value.uri) return back('error', 'This claim cannot be verified. Delete it and add it again.')
    const platform = norm.value.platform
    const method = methodFor(platform)
    const store = getClaimStore()
    const redirectUri = `${PUBLIC_URL}${CALLBACK_PATH}`

    if (method === 'rel-me') {
      if (coolingDown(`relme:${did}:${rkey}`, 15_000)) return back('error', 'Wait a few seconds before checking again.')
      const handle = await repoHandle(session)
      if (!handle) return back('error', 'Your account needs a valid handle to build the profile link.')
      const r = await verifyRelMe(claim.value.uri, profileLinkFor(PUBLIC_URL, handle), safeFetch)
      if (!r.ok) return back('error', `${PLATFORM_LABELS[platform]} was not verified. ${r.reason}`)
      await attestVerified(did, claim, method)
      return back('done', `${PLATFORM_LABELS[platform]} verified.`)
    }

    if (method === 'dns-txt') {
      if (coolingDown(`dns:${did}:${rkey}`, 10_000)) return back('error', 'Wait a few seconds before checking again.')
      const r = await verifyDnsTxt(claim.value.uri, did)
      if (!r.ok) return back('error', `The domain was not verified. ${r.reason}`)
      await attestVerified(did, claim, method)
      return back('done', 'Domain verified.')
    }
    if (method === 'bsky-proof') {
      if (coolingDown(`bsky:${did}:${rkey}`, 10_000)) return back('error', 'Wait a few seconds before checking again.')
      const r = await verifyBluesky(claim.value.uri, did, safeFetch)
      if (!r.ok) return back('error', `Bluesky was not verified. ${r.reason}`)
      await attestVerified(did, claim, method)
      return back('done', 'Bluesky verified.')
    }

    const state = randomBytes(24).toString('base64url')
    if (isOAuthProvider(platform) && method === `${platform}-oauth`) {
      const cfg = providerConfig(platform)
      if (!cfg) return back('error', `${PLATFORM_LABELS[platform]} verification is not available yet.`)
      await store.putState({ state, did, rkey, provider: platform })
      target = providerAuthorizeUrl(platform, cfg, redirectUri, state)
    } else if (method === 'github-oauth') {
      const cfg = githubConfig()
      if (!cfg) return back('error', 'GitHub verification is not configured on this server.')
      await store.putState({ state, did, rkey, provider: 'github' })
      target = githubAuthorizeUrl(cfg, redirectUri, state)
    } else {
      const m = parseMastodonUri(claim.value.uri)
      if (!m) return back('error', 'This Mastodon claim is malformed.')
      if (coolingDown(`mastodon:${did}:${rkey}`, 5_000)) return back('error', 'Wait a few seconds and try again.')
      const app = (await store.mastodonApp(m.instance)) ?? (await registerApp(m.instance, redirectUri, PUBLIC_URL, safeFetch))
      if (!app) return back('error', `${m.instance} did not accept the app registration.`)
      if (app.redirectUri !== redirectUri) return back('error', 'The stored app registration for that instance uses another address.')
      await store.putMastodonApp(app)
      await store.putState({ state, did, rkey, provider: 'mastodon', instance: m.instance })
      target = authorizeUrl(app, state)
    }
  } catch (err) {
    console.error('claim verify failed', err instanceof Error ? err.message : 'unknown')
    return back('error', message(err))
  }
  return redirect(target)
}
