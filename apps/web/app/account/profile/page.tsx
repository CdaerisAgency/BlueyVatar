import { normalizeBackgroundColor } from '@blueyvatar/core'
import { PageHeader, PageMain } from '../../../components/Page'
import Link from 'next/link'
import { COPY } from '../../../lib/copy'
import { requireDid } from '../../../lib/auth'
import { RepoError, getProfile, repoSession, type ProfileRecord } from '../../../lib/repo'
import { ProfileForm } from './ProfileForm'
import { ProfileShare } from '../../../components/ProfileShare'
import { repoHandle } from '../../../lib/claims-repo'
import { siteUrl } from '../../../lib/site'

const DELIVERY_URL = process.env.DELIVERY_URL ?? 'http://localhost:3001'
const PUBLIC_DELIVERY_URL = process.env.PUBLIC_DELIVERY_URL || DELIVERY_URL


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
      <PageHeader title="Profile" intro="Add public details such as your job title and location. Wallets stay hidden unless you choose to show them." />
      <p>These fields are saved in your repository as com.blueyvatar.profile and are public. Display name and bio stay in your atproto profile.</p>
      <p><Link href="/account#share">{COPY.share.pointer}</Link></p>
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
    </PageMain>
  )
}
