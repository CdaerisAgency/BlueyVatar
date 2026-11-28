import { PageMain } from '../../components/Page'
import { INTEGRATIONS_GUIDES_LEAD, INTEGRATIONS_GUIDES_LINK } from '../../lib/copy/public'
import { pageMetadata } from '../../lib/site'
import { ATPROTO_APP_LIST, PROOF_METHODS, signInEntries } from '../../lib/integrations'
import PushSection from './PushSection'

export const metadata = pageMetadata(
  '/integrations',
  'Integrations',
  'Accounts and apps BlueyVatar links to your profile: choose which atproto apps get your profile picture, sign-in platforms, and proof checks.',
)
// Which sign-in platforms are on depends on runtime settings.
export const dynamic = 'force-dynamic'

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string; ask?: string }> }) {
  const { error, done, ask } = await searchParams
  const signIn = signInEntries()
  return (
    <PageMain>
      <h1>Integrations</h1>
      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}

      <PushSection ask={ask} />

      <p>Your profile can show the accounts you own elsewhere, each one checked before it appears. Below are guides for your own site, the atproto apps BlueyVatar recognizes, and the ways an account is checked.</p>

      <h2>Use BlueyVatar on your site</h2>
      <p>{INTEGRATIONS_GUIDES_LEAD} <a href="/docs">{INTEGRATIONS_GUIDES_LINK}</a>.</p>

      <h2>atproto apps</h2>
      <p>
        These apps store your data in your own atproto repository, the same place as your BlueyVatar profile. When your repo holds records from one of them, BlueyVatar
        shows it as linked. You do not sign in again or verify anything, because signing in to BlueyVatar already proved the account.
      </p>
      <ul aria-label="atproto apps">
        {ATPROTO_APP_LIST.map((a) => (
          <li key={a.id}>
            <strong>
              <a href={a.url} rel="noopener">{a.name}</a>
            </strong>{' '}
            {a.description}
          </li>
        ))}
      </ul>
      <p>App names belong to their owners. Listing an app here does not mean the app endorses BlueyVatar.</p>

      <h2>Verified by sign-in</h2>
      <p>You sign in once at the platform. BlueyVatar reads only the account name, then discards the token.</p>
      <ul aria-label="Sign-in platforms">
        {signIn.map((s) => (
          <li key={s.platform}>
            <strong>{s.name}</strong> {s.live ? 'Available' : 'Coming soon'}
          </li>
        ))}
      </ul>

      <h2>Verified by proof</h2>
      <p>No platform is involved. You place a small proof where only you can, and BlueyVatar looks for it.</p>
      <ul aria-label="Proof checks">
        {PROOF_METHODS.map((m) => (
          <li key={m.name}>
            <strong>{m.name}.</strong> {m.how}
          </li>
        ))}
      </ul>
    </PageMain>
  )
}
