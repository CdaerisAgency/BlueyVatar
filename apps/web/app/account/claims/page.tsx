import { PageMain } from '../../../components/Page'
import { Button } from '../../../components/Button'
import { redirect } from 'next/navigation'
import AccountNav from '../AccountNav'
import { currentDid } from '../../../lib/auth'
import { getClaimStore } from '../../../lib/claim-store'
import { DNS_PROOF_LABEL, PLATFORMS, PLATFORM_LABELS, isPlatform, profileLinkFor, proofToken } from '../../../lib/claims'
import { methodFor, platformAvailable } from '../../../lib/claim-providers'
import { listClaims, repoHandle, type StoredClaim } from '../../../lib/claims-repo'
import { PUBLIC_URL } from '../../../lib/oauth'
import { RepoError, repoSession } from '../../../lib/repo'
import { addClaim, deleteClaimAction, setHidden, verifyClaim } from './actions'

export const dynamic = 'force-dynamic'

const HELP: Record<string, string> = {
  github: 'GitHub asks you to sign in once. blueyvatar reads only your username.',
  mastodon: 'Your Mastodon instance asks you to sign in once. blueyvatar reads only your account address.',
  website: 'Add a link to your blueyvatar profile on that page with rel="me".',
  instagram: 'Add a link to your blueyvatar profile on that page with rel="me". Instagram may not show bio links to crawlers, so this can fail.',
  domain: 'Add a TXT record to the domain (see the exact name and value below). Domain changes can take a while to spread.',
  bluesky: 'Your own Bluesky account verifies at once. For another account, put the proof text below in that account\'s bio. blueyvatar reads the public profile.',
  threads: 'Threads asks you to sign in once. blueyvatar reads only your username.',
  tiktok: 'TikTok asks you to sign in once. blueyvatar reads only your username.',
  youtube: 'Google asks you to sign in once. blueyvatar reads only the ID of the channel you own. Use the channel ID address (youtube.com/channel/UC...), not an @handle.',
  twitch: 'Twitch asks you to sign in once. blueyvatar reads only your username.',
  x: 'Add a link to your blueyvatar profile on that page with rel="me". X may not show bio links to crawlers, so this can fail.',
}

const checkLabel = (platform: Parameters<typeof methodFor>[0], label: string): string => {
  const m = methodFor(platform)
  return m === 'rel-me' ? 'Check my page' : m === 'dns-txt' || m === 'bsky-proof' ? 'Check now' : `Verify with ${label}`
}

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const did = await currentDid()
  if (!did) redirect('/login')
  const { error, done } = await searchParams
  let claims: StoredClaim[] = []
  let handle: string | null = null
  let loadError: string | null = null
  try {
    const session = await repoSession(did)
    ;[claims, handle] = await Promise.all([listClaims(session), repoHandle(session).catch(() => null)])
  } catch (err) {
    loadError = err instanceof RepoError ? err.message : 'Your claims could not be loaded.'
  }
  const status = new Map((await getClaimStore().latestAttestations(did)).map((a) => [a.claimRkey, a]))
  const link = handle ? profileLinkFor(PUBLIC_URL, handle) : null

  return (
    <PageMain>
      <h1>Verified accounts</h1>
      <AccountNav />
      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}
      {loadError && <p role="alert">{loadError}</p>}
      <p>
        Claims live in your repo. Your profile shows a claim only after blueyvatar verifies it. Hidden accounts are omitted from hovercards.
      </p>

      <h2>Your claims</h2>
      {claims.length === 0 ? (
        <p>No claims yet.</p>
      ) : (
        <ul>
          {claims.map((c) => {
            const a = status.get(c.rkey)
            const verified = a?.result === 'verified' && a.claimUri === c.value.uri
            const label = PLATFORM_LABELS[c.value.platform] ?? c.value.platform
            return (
              <li key={c.rkey} className="mb-3">
                <strong>{label}</strong> <code>{c.value.uri}</code>{' '}
                {verified ? <span>Verified ({a!.method}){c.value.hidden ? ', hidden from hovercards' : ''}</span> : <span>Not verified</span>}
                <div className="mt-1 flex flex-wrap gap-2">
                  {isPlatform(c.value.platform) && platformAvailable(c.value.platform) ? (
                    <form action={verifyClaim}>
                      <input type="hidden" name="rkey" value={c.rkey} />
                      <Button type="submit">{verified ? 'Verify again' : checkLabel(c.value.platform, label)}</Button>
                    </form>
                  ) : (
                    <span>Verification is not available for this platform right now.</span>
                  )}
                  <form action={setHidden}>
                    <input type="hidden" name="rkey" value={c.rkey} />
                    <input type="hidden" name="hidden" value={String(!c.value.hidden)} />
                    <Button type="submit">{c.value.hidden ? 'Show in hovercards' : 'Hide from hovercards'}</Button>
                  </form>
                  <form action={deleteClaimAction}>
                    <input type="hidden" name="rkey" value={c.rkey} />
                    <Button type="submit">Delete</Button>
                  </form>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <h2>Add a claim</h2>
      <form action={addClaim}>
        <label>
          Platform{' '}
          <select name="platform" defaultValue="github">
            {PLATFORMS.map((p) => (
              <option key={p} value={p} disabled={!platformAvailable(p)}>
                {PLATFORM_LABELS[p]}{platformAvailable(p) ? '' : ' (not available yet)'}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          Account or address <input name="account" required maxLength={300} placeholder="username, @name@instance, or https://..." />
        </label>
        <Button type="submit" variant="primary">Add</Button>
      </form>

      <h2>How each platform is checked</h2>
      <ul>
        {PLATFORMS.map((p) => (
          <li key={p}>
            <strong>{PLATFORM_LABELS[p]}.</strong> {platformAvailable(p) ? HELP[p] : 'Not available yet.'}
          </li>
        ))}
      </ul>
      <p>
        Proof text for Bluesky bios and domain records: <code>{proofToken(did)}</code>. For a domain, create a TXT record
        named <code>{DNS_PROOF_LABEL}.your-domain</code> whose value is exactly that text. Remove the proof and the badge goes
        away at the next re-check.
      </p>
      {link && (
        <p>
          Your profile link for rel=&quot;me&quot; checks: <code>{link}</code>
        </p>
      )}
    </PageMain>
  )
}
