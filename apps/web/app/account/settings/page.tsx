import Link from 'next/link'
import { Button } from '../../../components/Button'
import { EmptyState, PageHeader, PageMain, Section } from '../../../components/Page'
import { currentSession, requireDid } from '../../../lib/auth'
import { getStore } from '../../../lib/store'
import { viewerFor } from '../../../lib/viewer'
import { displayName } from '../../../lib/viewer-core'
import { DANGER_ZONE, SETTINGS_GROUPS } from '../../../lib/settings-hub'
import { signOutEverywhere, signOutSession } from './actions'

export const dynamic = 'force-dynamic'

const when = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const did = await requireDid('/account/settings')
  const { error, done } = await searchParams
  const here = (await currentSession())?.sid ?? null
  const viewer = await viewerFor(did)
  const sessions = await getStore().sessions.list(did)
  return (
    <PageMain>
      <PageHeader title="Sign-out options" intro="See where you are signed in, and sign out of one device or all of them." />
      <p>Signed in as {displayName(viewer)}</p>
      {SETTINGS_GROUPS.map((g) => (
        <Section key={g.title} title={g.title} id={`g-${g.title}`}>
          <ul className="list-none p-0">
            {g.links.map((l) => (
              <li key={l.href}>
                <Link href={l.href}>{l.label}</Link>: {l.description}
              </li>
            ))}
          </ul>
        </Section>
      ))}

      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}
      <Section title="Sessions" id="sessions" intro="Browsers and devices signed in to this account. Sessions older than 30 days expire on their own.">
      {sessions.length === 0 ? (
        <EmptyState>No tracked sessions yet. Older sign-ins may not be listed here. &quot;Sign out everywhere&quot; ends those too.</EmptyState>
      ) : (
        <ul>
          {sessions.map((s) => (
            <li key={s.id}>
              <strong>{s.device}</strong>
              {s.id === here && ' (this device)'}
              <br />
              Signed in {when(s.createdAt)}. Last used {when(s.lastUsedAt)}.
              {s.id !== here && (
                <form action={signOutSession} className="inline">
                  <input type="hidden" name="id" value={s.id} />{' '}
                  <Button type="submit">Sign out</Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      <form action={signOutEverywhere}>
        <Button type="submit" variant="danger">Sign out everywhere</Button>
      </form>
      </Section>

      <Section title="Account ID" id="account-id">
        <p>
          Some apps and support requests ask for this. <code>{did}</code>
        </p>
      </Section>

      <Section title="Danger zone" id="danger" tone="danger">
        <p>
          <Link href={DANGER_ZONE.href}>{DANGER_ZONE.label}</Link>: {DANGER_ZONE.description}
        </p>
      </Section>
    </PageMain>
  )
}
