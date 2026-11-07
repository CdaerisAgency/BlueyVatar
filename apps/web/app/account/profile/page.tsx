import { normalizeBackgroundColor } from '@blueyvatar/core'
import { PageMain } from '../../../components/Page'
import { Button } from '../../../components/Button'
import { requireDid } from '../../../lib/auth'
import { RepoError, getProfile, repoSession, type ProfileRecord } from '../../../lib/repo'
import { MAX_INTERESTS } from '../../../lib/records'
import AccountNav from '../AccountNav'
import { saveProfile } from './actions'

export const dynamic = 'force-dynamic'

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const did = await requireDid('/account/profile')
  const { error, done } = await searchParams
  let p: Partial<ProfileRecord> = {}
  let loadError: string | null = null
  try {
    p = (await getProfile(await repoSession(did)))?.value ?? {}
  } catch (err) {
    loadError = err instanceof RepoError ? err.message : 'Could not read your repository.'
  }
  const field = (name: string, label: string, value: string | undefined, max: number) => (
    <label>
      {label} <input name={name} defaultValue={value ?? ''} maxLength={max} />
    </label>
  )
  return (
    <PageMain>
      <AccountNav />
      <h1>Profile</h1>
      <p>These fields are saved in your repository as com.blueyvatar.profile and are public. Display name, bio, and links stay in your Bluesky profile.</p>
      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}
      {loadError && <p role="alert">{loadError}</p>}
      <form action={saveProfile}>
        {field('jobTitle', 'Job title', p.jobTitle, 1000)}
        {field('company', 'Company', p.company, 1000)}
        {field('location', 'Location', p.location, 1000)}
        {field('pronouns', 'Pronouns', p.pronouns, 400)}
        {field('pronunciation', 'Name pronunciation', p.pronunciation, 1000)}
        {field('timezone', 'Time zone (IANA, such as America/New_York)', p.timezone, 64)}
        <label>
          Interests (up to {MAX_INTERESTS}, separated by commas or new lines)
          <textarea name="interests" rows={3} defaultValue={(p.interests ?? []).join(', ')} />
        </label>
        <label>
          Page background color
          <input type="color" name="backgroundColor" defaultValue={normalizeBackgroundColor(p.backgroundColor) ?? '#ffffff'} />
        </label>
        <label>
          <input type="checkbox" name="clearBackgroundColor" defaultChecked={!normalizeBackgroundColor(p.backgroundColor)} /> Use the default colors (clears the background color)
        </label>
        <p>Text on your profile page switches between dark and white to stay readable. A color that works with neither is ignored and the default colors show.</p>
        <Button type="submit" variant="primary" disabled={loadError !== null}>
          Save profile
        </Button>
      </form>
    </PageMain>
  )
}
