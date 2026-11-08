import { normalizeBackgroundColor } from '@blueyvatar/core'
import { PageMain } from '../../../components/Page'
import { requireDid } from '../../../lib/auth'
import { RepoError, getProfile, repoSession, type ProfileRecord } from '../../../lib/repo'
import { ProfileForm } from './ProfileForm'
import { ProfileShare } from '../../../components/ProfileShare'
import { repoHandle } from '../../../lib/claims-repo'
import { siteUrl } from '../../../lib/site'

const DELIVERY_URL = process.env.DELIVERY_URL ?? 'http://localhost:3001'
const PUBLIC_DELIVERY_URL = process.env.PUBLIC_DELIVERY_URL || DELIVERY_URL

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const did = await requireDid('/account/profile')
  let p: Partial<ProfileRecord> = {}
  let loadError: string | null = null
  let handle: string | null = null
  try {
    const session = await repoSession(did)
    p = (await getProfile(session))?.value ?? {}
    handle = await repoHandle(session).catch(() => null)
  } catch (err) {
    loadError = err instanceof RepoError ? err.message : 'Could not read your repository.'
  }
  const color = normalizeBackgroundColor(p.backgroundColor)
  return (
    <PageMain>
      <h1>Profile</h1>
      <p>These fields are saved in your repository as com.blueyvatar.profile and are public. Display name and bio stay in your atproto profile. Wallets stay hidden unless you choose to show them.</p>
      {loadError && <p role="alert" id="profile-load-error">{loadError}</p>}
      {loadError === null && (
        <ProfileForm
          hasColor={Boolean(color)}
          initial={{
            jobTitle: p.jobTitle ?? '',
            company: p.company ?? '',
            location: p.location ?? '',
            pronouns: p.pronouns ?? '',
            pronunciation: p.pronunciation ?? '',
            timezone: p.timezone ?? '',
            interests: (p.interests ?? []).join(', '),
            backgroundColor: color ?? '',
            clearBackgroundColor: !color,
            languages: (p.languages ?? []).map((l) => ({ tag: l.tag, primary: l.primary === true })),
            socialLinks: (p.socialLinks ?? []).map((l) => ({ label: l.label ?? '', url: l.url })),
            wallets: (p.wallets ?? []).map((w) => ({ chain: w.chain, address: w.address, label: w.label ?? '', visible: w.visible === true })),
          }}
        />
      )}
      {handle && (
        <>
          <h2>Download and QR code</h2>
          <p>These files and the QR code show what visitors can see on your public profile. Wallets appear only when you chose to show them, and they are marked not verified.</p>
          <ProfileShare handle={handle} deliveryBase={PUBLIC_DELIVERY_URL} profileUrl={`${siteUrl()}/p/${encodeURIComponent(handle)}`} />
        </>
      )}
    </PageMain>
  )
}
