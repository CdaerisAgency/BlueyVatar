import Link from 'next/link'
import { PageMain } from '../../components/Page'
import { pageMetadata } from '../../lib/site'
import { jsonLdString } from '../../lib/seo'
import { imgSnippet, markdownSnippet } from '../../lib/avatar-snippets'
import { exampleMigration, EXAMPLE_GRAVATAR_URL, FAQS, faqJsonLd, GRAVATAR_DOCS } from '../../lib/gravatar-pages'

export const metadata = pageMetadata(
  '/migrate-from-gravatar',
  'Migrate from Gravatar to BlueyVatar',
  'Four steps: sign in, link your email, import your image, and change the base URL in your site. Includes copy-ready snippets.',
)

export default function MigratePage() {
  const ex = exampleMigration()
  return (
    <PageMain>
      <h1>Migrate from Gravatar to BlueyVatar</h1>
      <p>
        This takes a few minutes. Your image moves into your own atproto repository, and your site points at a new base URL. See{' '}
        <Link href="/gravatar-alternative">what stays the same and what differs</Link> first if you want the details.
      </p>

      <h2>1. Sign in</h2>
      <p>
        <Link href="/login">Sign in</Link> with the atproto account you already have. There is no password and no new account.
      </p>

      <h2>2. Link your email</h2>
      <p>Add the email you used for your avatar. BlueyVatar checks it with a one-time code, then serves your image for that email hash.</p>

      <h2>3. Import from Gravatar</h2>
      <p>
        Open the <Link href="/account/avatars/import">import page</Link> and choose Gravatar. You confirm the rating before the image is saved to your repository, where it is public.
      </p>

      <h2>4. Change the base URL</h2>
      <p>
        Gravatar documents image URLs as <code>https://gravatar.com/avatar/HASH</code> with query parameters (
        <a href={GRAVATAR_DOCS.images} rel="noopener">Gravatar images documentation</a>). Keep the hash and the query string, and swap the host:
      </p>
      <pre><code>{EXAMPLE_GRAVATAR_URL}</code></pre>
      <pre><code>{ex.url}</code></pre>
      <p>Developers can run any Gravatar URL through <code>fromGravatarUrl</code> in the <code>@blueyvatar/avatar</code> package. It returns the new options and plain-language notes about anything that changed.</p>

      <h3>HTML</h3>
      <pre><code>{imgSnippet(ex.url, 200)}</code></pre>
      <h3>Markdown</h3>
      <pre><code>{markdownSnippet(ex.url)}</code></pre>
      <p>Replace the sample hash with your own SHA-256 or MD5 email hash. Raw emails are rejected.</p>

      <h2>Questions</h2>
      <ul aria-label="Frequently asked questions">
        {FAQS.map((f) => (
          <li key={f.q}>
            <h3>{f.q}</h3>
            <p>{f.a}</p>
          </li>
        ))}
      </ul>
      <p>BlueyVatar is not affiliated with Gravatar.</p>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(faqJsonLd()) }} />
    </PageMain>
  )
}
