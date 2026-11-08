import { PageMain } from '../../../components/Page'
import CopyField from '../CopyField'
import { Button } from '../../../components/Button'
import { requireDid } from '../../../lib/auth'
import { getClaimStore } from '../../../lib/claim-store'
import { DNS_PROOF_LABEL, PLATFORMS, PLATFORM_LABELS, dnsProofName, isPlatform, profileLinkFor, proofToken, type Platform } from '../../../lib/claims'
import { methodFor, platformAvailable } from '../../../lib/claim-providers'
import { listClaims, repoHandle, type StoredClaim } from '../../../lib/claims-repo'
import { PUBLIC_URL } from '../../../lib/oauth'
import { detectAtprotoApps, type AtprotoApp } from '@blueyvatar/core'
import { RepoError, repoSession, xrpc } from '../../../lib/repo'
import { addClaim, deleteClaimAction, setHidden, verifyClaim } from './actions'

export const dynamic = 'force-dynamic'

const HELP: Record<string, string> = {
  github: 'GitHub asks you to sign in once. BlueyVatar reads only your username.',
  mastodon: 'Your Mastodon instance asks you to sign in once. BlueyVatar reads only your account address.',
  website: 'You add a link back to your BlueyVatar profile on that page. See the steps under the account once you add it.',
  instagram: 'You add a link back to your BlueyVatar profile in your Instagram profile. Instagram may hide links from checkers, so this can fail.',
  domain: 'You add a TXT record to the domain. See the steps under the account once you add it. Domain changes can take a while to spread.',
  bluesky: 'Your own Bluesky account is verified at once. For another account, you paste a line of text into that account\'s bio, and BlueyVatar reads the public profile.',
  threads: 'Threads asks you to sign in once. BlueyVatar reads only your username.',
  tiktok: 'TikTok asks you to sign in once. BlueyVatar reads only your username.',
  youtube: 'Google asks you to sign in once. BlueyVatar reads only the ID of the channel you own. Use the channel ID address (youtube.com/channel/UC...), not an @handle.',
  twitch: 'Twitch asks you to sign in once. BlueyVatar reads only your username.',
  x: 'You add a link back to your BlueyVatar profile in your X profile. X may hide links from checkers, so this can fail.',
}

const checkLabel = (platform: Parameters<typeof methodFor>[0], label: string): string => {
  const m = methodFor(platform)
  return m === 'rel-me' || m === 'dns-txt' || m === 'bsky-proof' ? 'Check now' : `Verify with ${label}`
}

/** The steps a person follows after adding an account, by how that account is checked. */
function NextStep({ platform, label, uri, did, link }: { platform: Platform; label: string; uri: string; did: string; link: string | null }) {
  const method = methodFor(platform)
  if (method === 'rel-me') {
    const where = platform === 'website' ? 'Open the page you added and put this link in its HTML, anywhere in the body.' : `Open your ${label} profile and put this link in its website or link field.`
    return (
      <div className="mt-2" role="group" aria-label={`Next step for ${label}`}>
        <p className="mb-1 font-semibold text-bv-black">Next step: link back to your profile</p>
        {link ? (
          <ol className="mb-2 list-decimal pl-6">
            <li>Copy this link.<CopyField label={`Link back to your profile, for ${label}`} value={`<a rel="me" href="${link}">My BlueyVatar profile</a>`} /></li>
            <li>{where}</li>
            <li>Come back here and press Check now.</li>
          </ol>
        ) : (
          <p>Your account needs a valid handle before BlueyVatar can build the link.</p>
        )}
        <p className="mb-0">This lets BlueyVatar see that the page and your profile belong to the same person.{platform === 'website' ? '' : ` ${label} may hide links from checkers, so the check can fail.`}</p>
      </div>
    )
  }
  if (method === 'bsky-proof') {
    return (
      <div className="mt-2" role="group" aria-label={`Next step for ${label}`}>
        <p className="mb-1 font-semibold text-bv-black">Next step: paste a line of text into that account&apos;s bio</p>
        <ol className="mb-2 list-decimal pl-6">
          <li>Copy this text.<CopyField label={`Proof text for ${label}`} value={proofToken(did)} /></li>
          <li>Paste it into the bio of the Bluesky account you added.</li>
          <li>Come back here and press Check now.</li>
        </ol>
        <p className="mb-0">If you added the Bluesky account you signed in with, you can skip steps 1 and 2. After it is verified you can remove the text from the bio.</p>
      </div>
    )
  }
  if (method === 'dns-txt') {
    const name = dnsProofName(uri) ?? `${DNS_PROOF_LABEL}.your-domain`
    return (
      <div className="mt-2" role="group" aria-label={`Next step for ${label}`}>
        <p className="mb-1 font-semibold text-bv-black">Next step: add a TXT record to your domain</p>
        <ol className="mb-2 list-decimal pl-6">
          <li>Sign in at the company that manages your domain&apos;s DNS and add a new TXT record.</li>
          <li>Copy these two values into the record.
            <CopyField label="Name" value={name} />
            <CopyField label="Value" value={proofToken(did)} />
          </li>
          <li>Save it. Changes can take a while to appear. Then come back here and press Check now.</li>
        </ol>
        <p className="mb-0">If you remove the record later, the badge goes away the next time BlueyVatar re-checks.</p>
      </div>
    )
  }
  return <p className="mt-2 mb-0">Next step: press Verify with {label}. It asks you to sign in once and then brings you back here.</p>
}

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const did = await requireDid('/account/claims')
  const { error, done } = await searchParams
  let claims: StoredClaim[] = []
  let handle: string | null = null
  let loadError: string | null = null
  let apps: AtprotoApp[] = []
  try {
    const session = await repoSession(did)
    ;[claims, handle, apps] = await Promise.all([
      listClaims(session),
      repoHandle(session).catch(() => null),
      // No sign-in needed: the DID is already proven, so records in an app's collection mean the same identity.
      xrpc<{ collections?: unknown }>(session, 'GET', 'com.atproto.repo.describeRepo', { params: { repo: did } })
        .then((r) => (Array.isArray(r.collections) ? detectAtprotoApps(r.collections) : []))
        .catch(() => [] as AtprotoApp[]),
    ])
  } catch (err) {
    loadError = err instanceof RepoError ? err.message : 'Your claims could not be loaded.'
  }
  const status = new Map((await getClaimStore().latestAttestations(did)).map((a) => [a.claimRkey, a]))
  const link = handle ? profileLinkFor(PUBLIC_URL, handle) : null

  return (
    <PageMain>
      <h1>Verified accounts</h1>
      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}
      {loadError && <p role="alert">{loadError}</p>}
      <p>
        A claim connects another account you own, such as GitHub, Mastodon, or your website, to your BlueyVatar profile. BlueyVatar checks each claim, and only checked claims appear on your profile.
      </p>
      <p>Accounts you hide stay verified but are left off your profile page and hover cards.</p>
      <details className="mb-5">
        <summary>What does &quot;link back to your profile&quot; mean?</summary>
        <p>
          For some accounts, BlueyVatar needs to see that the other page points back to your profile. You do that by adding a link to your BlueyVatar profile on that page. In web page code the link carries a small tag, <code>rel=&quot;me&quot;</code>, which tells sites that the link goes to another page of yours. You only need to copy the link we give you.
        </p>
      </details>

      <h2>Your verified accounts</h2>
      {claims.length === 0 ? (
        <p>You have no accounts yet. Add one below to show a verified link to your GitHub, Mastodon, website, or another account on your profile. Each one is checked before it appears.</p>
      ) : (
        <ul>
          {claims.map((c) => {
            const a = status.get(c.rkey)
            const verified = a?.result === 'verified' && a.claimUri === c.value.uri
            const label = PLATFORM_LABELS[c.value.platform] ?? c.value.platform
            const available = isPlatform(c.value.platform) && platformAvailable(c.value.platform)
            return (
              <li key={c.rkey} className="mb-3">
                <strong>{label}</strong> <code>{c.value.uri}</code>{' '}
                {verified ? <span>Verified ({a!.method}){c.value.hidden ? ', hidden from your profile' : ''}</span> : <span>Not verified</span>}
                {!verified && available && isPlatform(c.value.platform) && (
                  <NextStep platform={c.value.platform} label={label} uri={c.value.uri} did={did} link={link} />
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {available && isPlatform(c.value.platform) ? (
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
                    <Button type="submit">{c.value.hidden ? 'Show on my profile' : 'Hide from my profile'}</Button>
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

      <h2>Add an account</h2>
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
        <Button type="submit" variant="primary">Add account</Button>
      </form>

      <h2>atproto apps</h2>
      {apps.length === 0 ? (
        <p>No other atproto apps found in your repo yet.</p>
      ) : (
        <>
          <p>Your repo has records from these apps. They count as linked because you signed in with this account. Nothing to verify.</p>
          <ul>
            {apps.map((a) => (
              <li key={a.id}>
                <strong>{a.name}</strong> <a href={a.url}>{a.url.replace('https://', '')}</a>
              </li>
            ))}
          </ul>
        </>
      )}

      <details>
        <summary>How each platform is checked</summary>
        <ul>
          {PLATFORMS.map((p) => (
            <li key={p}>
              <strong>{PLATFORM_LABELS[p]}.</strong> {platformAvailable(p) ? HELP[p] : 'Not available yet.'}
            </li>
          ))}
        </ul>
      </details>
    </PageMain>
  )
}
