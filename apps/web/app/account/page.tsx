import { PageMain } from '../../components/Page'
import { Button, ButtonLink } from '../../components/Button'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { qrSvg } from '@blueyvatar/core'
import { addEmail, linkEmail, makePrimary, unlink } from '../actions'
import { requireDid } from '../../lib/auth'
import { imgSnippet, markdownSnippet } from '../../lib/avatar-snippets'
import { ownerAvatarUrl } from '../../lib/avatar-preview'
import { describeLinkedEmails, readPrimaryAddress } from '../../lib/linked-emails'
import { getDashboardStore } from '../../lib/dashboard-store'
import { CHECKLIST_COOKIE, checklist, parsePrefs, showChecklist } from '../../lib/onboarding'
import { getClaimStore } from '../../lib/claim-store'
import { PLATFORM_LABELS } from '../../lib/claims'
import { listClaims, repoHandle } from '../../lib/claims-repo'
import { MAX_LINKED_EMAILS, HOLD_DAYS } from '../../lib/email-policy'
import { PUBLIC_URL } from '../../lib/oauth'
import { getProfile, listImages, repoSession, type ProfileRecord } from '../../lib/repo'
import { getStore } from '../../lib/store'
import { viewerFor } from '../../lib/viewer'
import { displayName } from '../../lib/viewer-core'
import CopyField from './CopyField'
import GallerySection from './GallerySection'
import LinkedEmail from './LinkedEmail'
import { setChecklistShown } from './checklist/actions'

export const dynamic = 'force-dynamic'

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string; linked?: string; qr?: string; galleryError?: string; galleryDone?: string }> }) {
  const did = await requireDid('/account')
  const { error, linked, qr, galleryError, galleryDone } = await searchParams
  const links = await getStore().links.list(did)
  const emails = describeLinkedEmails(links, readPrimaryAddress(await getStore().links.noticeAddress(did).catch(() => undefined)))

  // QR code for the user's own profile. The target can be a verified, visible platform.
  let handle: string | null = null
  const platforms = new Map<string, string>()
  let avatarCount: number | null = null
  let profile: ProfileRecord | null = null
  try {
    const session = await repoSession(did)
    const [claims, h, attestations, images, prof] = await Promise.all([
      listClaims(session),
      repoHandle(session),
      getClaimStore().latestAttestations(did),
      // The checklist reads these too. A failure here only hides the checklist.
      listImages(session).catch(() => null),
      getProfile(session).catch(() => undefined),
    ])
    handle = h
    avatarCount = images && prof !== undefined ? images.length : null
    profile = prof?.value ?? null
    const status = new Map(attestations.map((a) => [a.claimRkey, a]))
    for (const c of claims) {
      const a = status.get(c.rkey)
      if (a?.result === 'verified' && a.claimUri === c.value.uri && !c.value.hidden && c.value.uri.startsWith('https://')) {
        platforms.set(c.value.platform.toLowerCase(), PLATFORM_LABELS[c.value.platform] ?? c.value.platform)
      }
    }
  } catch {
    handle = null
  }
  const target = qr && platforms.has(qr) ? qr : ''
  const qrUrl = handle ? (target ? `${PUBLIC_URL}/go/${encodeURIComponent(handle)}/${target}` : `${PUBLIC_URL}/p/${handle}`) : null
  const svg = qrUrl ? qrSvg(qrUrl, 256) : null
  const prefs = parsePrefs((await cookies()).get(CHECKLIST_COOKIE)?.value)
  const list =
    avatarCount === null
      ? null
      : checklist({
          emailLinked: links.length > 0,
          avatarCount,
          profile,
          visibilitySaved: await getDashboardStore().rulesSaved(did).catch(() => false),
          viewedPublicProfile: prefs.viewed,
        })
  const primary = links.find((l) => l.primary)
  const url = primary ? ownerAvatarUrl(primary.emailHash) : null
  return (
    <PageMain>
      <h1>Account</h1>
      <p>Signed in as {displayName(await viewerFor(did))}</p>
      {list && showChecklist(list.complete, prefs.showAgain) && (
        <section id="checklist" aria-labelledby="checklist-h">
          <h2 id="checklist-h">Get started ({list.done} of {list.total} done)</h2>
          <p>{list.complete ? 'Everything is set up.' : 'Work through these in any order.'}</p>
          <ol>
            {list.steps.map((st) => (
              <li key={st.id}>
                <span aria-hidden="true">{st.done ? '[x]' : '[ ]'}</span> <Link href={st.href}>{st.title}</Link>
                <span className="sr-only">{st.done ? ' (done)' : ' (to do)'}</span>. {st.hint}
              </li>
            ))}
          </ol>
          {list.complete && (
            <form action={setChecklistShown}>
              <input type="hidden" name="show" value="0" />
              <Button type="submit">Hide checklist</Button>
            </form>
          )}
        </section>
      )}
      {list && list.complete && !prefs.showAgain && (
        <div>
          Setup is complete. <form action={setChecklistShown} className="inline"><input type="hidden" name="show" value="1" /><button type="submit" className="cursor-pointer border-0 bg-transparent p-0 text-bv-blue underline">Show the checklist again</button></form>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {linked && <p>Linked {linked}. A hash of it is stored, and an encrypted copy of your primary email.</p>}
      <h2>Linked emails ({links.length} of {MAX_LINKED_EMAILS})</h2>
      {links.length === 0 ? (
        <p>No email linked yet. <a href="#link-email">Link one below</a> so apps can find your avatar from your address.</p>
      ) : (
        <ul>
          {links.map((l, i) => (
            <li key={l.emailHash}>
              <LinkedEmail item={emails[i]!} />{' '}
              {!l.primary && (
                <form action={makePrimary} className="inline">
                  <input type="hidden" name="hash" value={l.emailHash} />
                  <Button type="submit">Make primary</Button>
                </form>
              )}{' '}
              <form action={unlink} className="inline">
                <input type="hidden" name="hash" value={l.emailHash} />
                <Button type="submit">Unlink</Button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <h2 id="link-email">Link email</h2>
      <p>
        You can link up to {MAX_LINKED_EMAILS} emails. An address you unlink is held for {HOLD_DAYS} days: only this account can
        link it again until then.
      </p>
      <p>
        We keep a hash of each linked email. For your primary email we also keep the address itself, encrypted, so we can tell you
        if a claim is removed or your email moves to another account. It is deleted when you unlink or replace it, or delete your
        data.
      </p>
      <form action={linkEmail}>
        <Button type="submit" variant="primary">Use the email from my Bluesky account</Button>
      </form>
      <form action={addEmail}>
        <label>
          Add another email by code <input name="email" type="email" required autoComplete="email" />
        </label>
        <Button type="submit" variant="primary">Send code</Button>
      </form>
      <section id="preview">
        <h2>Your avatar URL</h2>
        {url ? (
          <>
            <p>This is how apps see the avatar for your primary email. The link holds a hash of your address, not the address itself.</p>
            <div className="flex items-center gap-3">
              {avatarCount === 0 ? (
                <span className="flex size-20 items-center justify-center rounded-full border border-solid border-bv-line text-sm" role="img" aria-label="No avatar yet">
                  No avatar
                </span>
              ) : (
                // Served by the delivery host, so next/image optimization does not apply. The square size comes from the class, not fixed attributes.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="Your current avatar" className="size-20 rounded-full object-cover" referrerPolicy="no-referrer" />
              )}
              <ButtonLink href="/account/avatars" variant="primary">Change your avatar</ButtonLink>
            </div>
            {avatarCount === 0 && <p>You have not added an avatar here yet. Until you do, apps that ask for this link get your Bluesky avatar if you have one, or a default avatar.</p>}
            <CopyField label="URL" value={url} />
            <CopyField label="HTML" value={imgSnippet(url)} />
            <CopyField label="Markdown" value={markdownSnippet(url)} />
          </>
        ) : (
          <p>Link an email above to get a preview and embed snippets.</p>
        )}
      </section>
      <GallerySection did={did} error={galleryError} done={galleryDone} />
      <h2>QR code</h2>
      {svg && qrUrl ? (
        <>
          <form method="get">
            <label>
              Target{' '}
              <select name="qr" defaultValue={target}>
                <option value="">Profile page</option>
                {[...platforms].map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </label>{' '}
            <Button type="submit">Update</Button>
          </form>
          <p>
            <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} alt={`QR code for ${qrUrl}`} width={256} height={256} />
          </p>
          <p>
            <code>{qrUrl}</code>
          </p>
          <p>
            <a href={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} download={`${handle}-qr.svg`}>Download SVG</a>
          </p>
        </>
      ) : (
        <p>Your QR code is unavailable until your handle can be loaded.</p>
      )}
      <h2>Your data</h2>
      <p>
        Go to <Link href="/account/settings/danger">Danger zone</Link> to download your data or delete it. Deleting removes what blueyvatar holds about you, except
        billing records, which we keep for 7 years. Records in your own atproto repository stay on your Bluesky account's home server.
      </p>
      <form action="/logout" method="post">
        <Button type="submit">Sign out</Button>
      </form>
    </PageMain>
  )
}
