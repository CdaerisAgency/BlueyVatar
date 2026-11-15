import { Notices, PageHeader, PageMain, Section } from '../../components/Page'
import { cookies } from 'next/headers'
import { qrSvg } from '@blueyvatar/core'
import { requireDid } from '../../lib/auth'
import { ownerAvatarUrl } from '../../lib/avatar-preview'
import { describeLinkedEmails, readPrimaryAddress } from '../../lib/linked-emails'
import { getDashboardStore } from '../../lib/dashboard-store'
import { CHECKLIST_COOKIE, checklist, parsePrefs } from '../../lib/onboarding'
import { getClaimStore } from '../../lib/claim-store'
import { PLATFORM_LABELS } from '../../lib/claims'
import { listClaims, repoHandle } from '../../lib/claims-repo'
import { PUBLIC_URL } from '../../lib/oauth'
import { getProfile, listImages, repoSession, type ProfileRecord } from '../../lib/repo'
import { getStore } from '../../lib/store'
import { SignedInAs } from '../../components/SignedInAs'
import { AvatarUrlSection } from './AvatarUrlSection'
import { ChecklistSection } from './ChecklistSection'
import { DataSection } from './DataSection'
import { LinkEmailSection } from './LinkEmailSection'
import { LinkedEmailsSection } from './LinkedEmailsSection'
import GallerySection from './GallerySection'
import { ShareSection } from './ShareSection'


export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string; qr?: string; galleryError?: string; galleryDone?: string }> }) {
  const did = await requireDid('/account')
  const { error, qr, galleryError, galleryDone } = await searchParams
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
      <PageHeader title="Overview" intro="Your linked emails, your avatar link, and where to go next." />
      <SignedInAs did={did} />
      {list && <ChecklistSection list={list} prefs={prefs} />}
      <Notices error={error} />
      <LinkedEmailsSection links={links} emails={emails} />
      <LinkEmailSection />
      <AvatarUrlSection url={url} avatarCount={avatarCount} />
      <GallerySection did={did} error={galleryError} done={galleryDone} />
      <ShareSection handle={handle} qrUrl={qrUrl} svg={svg} target={target} platforms={platforms} />
      <DataSection />
    </PageMain>
  )
}
