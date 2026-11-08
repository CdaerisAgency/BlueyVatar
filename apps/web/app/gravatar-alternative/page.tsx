import Link from 'next/link'
import { PageMain, TableBox } from '../../components/Page'
import { pageMetadata } from '../../lib/site'
import { jsonLdString } from '../../lib/seo'
import { exampleMigration, EXAMPLE_GRAVATAR_URL, FAQS, faqJsonLd, GRAVATAR_DOCS } from '../../lib/gravatar-pages'

export const metadata = pageMetadata(
  '/gravatar-alternative',
  'A Gravatar alternative on atproto | blueyvatar',
  'How blueyvatar matches the Gravatar avatar URL shape and where it differs: atproto storage, rating mapping, and size caps by plan.',
)

export default function GravatarAlternativePage() {
  const ex = exampleMigration()
  return (
    <PageMain>
      <h1>A Gravatar alternative on atproto</h1>
      <p>
        blueyvatar serves avatars from an image URL built from an email hash, like other avatar services, and keeps the image in your own atproto repository. This page
        lists what stays the same and what differs. blueyvatar is not affiliated with Gravatar.
      </p>

      <h2>What stays the same</h2>
      <p>
        Gravatar documents an avatar URL of the form <code>https://gravatar.com/avatar/HASH</code>, with an optional <code>.jpg</code> extension and query parameters (
        <a href={GRAVATAR_DOCS.images} rel="noopener">Gravatar images documentation</a>,{' '}
        <a href={GRAVATAR_DOCS.sdkImages} rel="noopener">Gravatar avatars component</a>). blueyvatar accepts the same parameters.
      </p>
      <TableBox label="Matching parameters">
        <table>
          <thead>
            <tr><th>Parameter</th><th>Gravatar documents</th><th>blueyvatar</th></tr>
          </thead>
          <tbody>
            <tr><td><code>s</code> or <code>size</code></td><td>1 to 2048 pixels, 80 by default</td><td>Same parameter. Caps by plan, see below.</td></tr>
            <tr><td><code>d</code> or <code>default</code></td><td>A URL or a keyword such as <code>404</code>, <code>mp</code>, <code>identicon</code>, <code>blank</code></td><td>Same parameter and most of the same keywords</td></tr>
            <tr><td><code>r</code> or <code>rating</code></td><td><code>g</code>, <code>pg</code>, <code>r</code>, <code>x</code>, with <code>g</code> by default</td><td>Same values and default</td></tr>
            <tr><td><code>f</code> or <code>forcedefault</code></td><td><code>y</code> forces the default image</td><td>Same parameter</td></tr>
            <tr><td>Optional file extension</td><td><code>.jpg</code></td><td><code>.png</code>, <code>.jpg</code>, <code>.jpeg</code>, and <code>.webp</code></td></tr>
          </tbody>
        </table>
      </TableBox>
      <p>
        Here is a sample Gravatar-style URL and the same request on blueyvatar, converted by the <code>@blueyvatar/avatar</code> package:
      </p>
      <pre><code>{EXAMPLE_GRAVATAR_URL}</code></pre>
      <pre><code>{ex.url}</code></pre>

      <h2>What differs</h2>
      <TableBox label="Differences">
        <table>
          <thead>
            <tr><th>Area</th><th>blueyvatar</th></tr>
          </thead>
          <tbody>
            <tr><td>Storage</td><td>Your atproto repository. The image and profile live in an account you own.</td></tr>
            <tr><td>Ratings</td><td>Mapped from atproto self-labels so an image rates the same in both places. The definitions are blueyvatar&apos;s own and can differ from the ones on Gravatar&apos;s pages.</td></tr>
            <tr><td>Size caps</td><td>Free 512, Plus 1024, Business and Enterprise 2048. Larger values are clamped and reported in the <code>x-adjusted-params</code> header.</td></tr>
            <tr><td>Image count</td><td>Free 3 images, Plus 20.</td></tr>
            <tr><td>Custom default URL</td><td>HTTPS only, on the service allowlist, with a Plus key or higher.</td></tr>
            <tr><td>Email input</td><td>SHA-256 or MD5 hash only. A raw email is always rejected.</td></tr>
            <tr><td>Per-email images</td><td>One avatar per account, shared by every linked hash.</td></tr>
            <tr><td><code>d=color</code></td><td>Not supported. <code>d=pagan</code> is an extra style.</td></tr>
          </tbody>
        </table>
      </TableBox>

      <h2>Move over</h2>
      <p>
        The <Link href="/migrate-from-gravatar">migration guide</Link> walks through importing your image and changing the base URL. See <Link href="/pricing">pricing</Link> for plan caps.
      </p>

      <h2>Questions</h2>
      <ul aria-label="Frequently asked questions">
        {FAQS.map((f) => (
          <li key={f.q}>
            <h3>{f.q}</h3>
            <p>{f.a}</p>
          </li>
        ))}
      </ul>
      <p>Gravatar is a name that belongs to its owner. Statements about Gravatar come from its own documentation, linked above.</p>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(faqJsonLd()) }} />
    </PageMain>
  )
}
