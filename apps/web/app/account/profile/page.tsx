import { normalizeBackgroundColor } from '@blueyvatar/core'
import { PageMain } from '../../../components/Page'
import { requireDid } from '../../../lib/auth'
import { RepoError, getProfile, repoSession, type ProfileRecord } from '../../../lib/repo'
import AccountNav from '../AccountNav'
import { ProfileForm } from './ProfileForm'

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const did = await requireDid('/account/profile')
  let p: Partial<ProfileRecord> = {}
  let loadError: string | null = null
  try {
    p = (await getProfile(await repoSession(did)))?.value ?? {}
  } catch (err) {
    loadError = err instanceof RepoError ? err.message : 'Could not read your repository.'
  }
  const color = normalizeBackgroundColor(p.backgroundColor)
  return (
    <PageMain>
      <AccountNav />
      <h1>Profile</h1>
      <p>These fields are saved in your repository as com.blueyvatar.profile and are public. Display name, bio, and links stay in your Bluesky profile.</p>
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
          }}
        />
      )}
    </PageMain>
  )
}
