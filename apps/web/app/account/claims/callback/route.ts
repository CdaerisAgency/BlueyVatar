import { NextResponse } from 'next/server'
import { currentDid } from '../../../../lib/auth'
import { getClaimStore } from '../../../../lib/claim-store'
import { PLATFORM_LABELS, normalizeClaim } from '../../../../lib/claims'
import { getClaim } from '../../../../lib/claims-repo'
import { githubClaimMatches, githubConfig, githubLogin } from '../../../../lib/github-oauth'
import { accountUrl, mastodonClaimMatches } from '../../../../lib/mastodon-oauth'
import { PUBLIC_URL } from '../../../../lib/oauth'
import { repoSession } from '../../../../lib/repo'
import { safeFetch } from '../../../../lib/safe-fetch'
import { attestVerified } from '../../../../lib/verification-service'
import { reportError } from '../../../../lib/obs'

export const dynamic = 'force-dynamic'

const REDIRECT_URI = `${PUBLIC_URL}/account/claims/callback`

function back(key: 'error' | 'done', value: string) {
  return NextResponse.redirect(new URL(`/account/claims?${key}=${encodeURIComponent(value)}`, PUBLIC_URL), 303)
}

/** Shared redirect target for GitHub and Mastodon. The state row says which provider and claim it is for. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const state = q.get('state')
  const code = q.get('code')
  const pending = state ? await getClaimStore().takeState(state) : null
  if (!pending) return back('error', 'That verification link expired. Start again.')
  if (q.get('error') || !code) return back('error', 'The account was not authorized, so nothing was verified.')
  if ((await currentDid()) !== pending.did) return back('error', 'Sign in again before verifying.')

  try {
    const claim = await getClaim(await repoSession(pending.did), pending.rkey)
    if (!claim) return back('error', 'That claim no longer exists.')
    const norm = normalizeClaim(claim.value.platform, claim.value.uri)
    if (!norm.ok || norm.value.uri !== claim.value.uri) return back('error', 'This claim cannot be verified.')

    if (pending.provider === 'github') {
      const cfg = githubConfig()
      const login = norm.value.platform === 'github' && cfg ? await githubLogin(cfg, code, REDIRECT_URI) : null
      if (!login || !githubClaimMatches(login, claim.value.uri)) {
        return back('error', 'The GitHub account you signed in with does not match this claim.')
      }
      await attestVerified(pending.did, claim, 'github-oauth')
    } else {
      const app = pending.instance ? await getClaimStore().mastodonApp(pending.instance) : null
      const url = norm.value.platform === 'mastodon' && app ? await accountUrl(app, code, safeFetch) : null
      if (!url || !mastodonClaimMatches(url, claim.value.uri)) {
        return back('error', 'The Mastodon account you signed in with does not match this claim.')
      }
      await attestVerified(pending.did, claim, 'mastodon-oauth')
    }
    return back('done', `${PLATFORM_LABELS[norm.value.platform]} verified.`)
  } catch (err) {
    reportError('claim callback failed', err)
    return back('error', 'Verification did not complete. Try again.')
  }
}
