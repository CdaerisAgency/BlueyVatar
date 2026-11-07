import { PageMain } from '../../components/Page'
import { pageMetadata } from '../../lib/site'
import { ATPROTO_APP_LIST, PROOF_METHODS, signInEntries } from '../../lib/integrations'

export const metadata = pageMetadata(
  '/integrations',
  'Integrations',
  'Accounts and apps blueyvatar links to your profile: atproto apps, sign-in platforms, and proof checks.',
)
// Which sign-in platforms are on depends on runtime settings.
export const dynamic = 'force-dynamic'

export default function IntegrationsPage() {
  const signIn = signInEntries()
  return (
    <PageMain>
      <h1>Integrations</h1>
      <p>Your profile can show the accounts you own elsewhere, each one checked before it appears. Beyond the guides above, there are three kinds.</p>

      <h2>Use blueyvatar on your site</h2>
      <p>Guides for putting avatars on a site you run. Each uses the SHA-256 hash route, a default image with <code>d=</code>, and a no-referrer policy.</p>
      <ul aria-label="Integration guides">
        <li><a href="/docs/integrations-html">Plain HTML</a></li>
        <li><a href="/docs/integrations-wordpress">WordPress</a> (plugin source in the repository, distributed as a GitHub release)</li>
        <li><a href="/docs/integrations-ghost">Ghost</a></li>
        <li><a href="/docs/integrations-discourse">Discourse</a></li>
      </ul>

      <h2>atproto apps</h2>
      <p>
        These apps store your data in your own atproto repository, the same place as your blueyvatar profile. When your repo holds records from one of them, blueyvatar
        shows it as linked. You do not sign in again or verify anything, because signing in to blueyvatar already proved the account.
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
      <p>App names belong to their owners. Listing an app here does not mean the app endorses blueyvatar.</p>

      <h2>Verified by sign-in</h2>
      <p>You sign in once at the platform. blueyvatar reads only the account name, then discards the token.</p>
      <ul aria-label="Sign-in platforms">
        {signIn.map((s) => (
          <li key={s.platform}>
            <strong>{s.name}</strong> {s.live ? 'Available' : 'Coming soon'}
          </li>
        ))}
      </ul>

      <h2>Verified by proof</h2>
      <p>No platform is involved. You place a small proof where only you can, and blueyvatar looks for it.</p>
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
