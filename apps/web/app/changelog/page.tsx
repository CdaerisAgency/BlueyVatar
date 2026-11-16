import { PageMain } from '../../components/Page'
import { changelogAnchor, emailParts, inlineParts, loadChangelog } from '../../lib/changelog'
import { pageMetadata } from '../../lib/site'

// Rendered from CHANGELOG.md when the app is built.
export const dynamic = 'force-static'

export const metadata = {
  ...pageMetadata('/changelog', 'Changelog | BlueyVatar', 'New features, changes, and fixes to BlueyVatar, newest first.'),
}

/** Text with each email address split around its "@" so the Cloudflare proxy leaves it alone (see emailParts). */
function Text({ text }: { text: string }) {
  return (
    <>
      {emailParts(text).map((p, i) =>
        p.email ? (
          <span key={i}>
            {p.email.local}
            <span>@</span>
            {p.email.domain}
          </span>
        ) : (
          p.text
        ),
      )}
    </>
  )
}

export default function ChangelogPage() {
  const entries = loadChangelog()
  return (
    <PageMain>
      <h1>Changelog</h1>
      <p>
        New features, changes, and fixes, newest first. <a href="/changelog/feed.xml">Subscribe with Atom</a>.
      </p>
      {entries.map((e) => (
        <section key={e.date} id={changelogAnchor(e)}>
          <h2>
            <a href={`#${changelogAnchor(e)}`}>
              <time dateTime={e.date}>{e.date}</time>
            </a>
          </h2>
          {e.groups.map((g) => (
            <div key={g.name}>
              <h3>{g.name}</h3>
              <ul className="list-disc pl-5">
                {g.items.map((item) => (
                  <li key={item} className="border-0! py-0.5!">
                    {inlineParts(item).map((p, i) => (p.code ? <code key={i}><Text text={p.text} /></code> : <Text key={i} text={p.text} />))}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </PageMain>
  )
}
