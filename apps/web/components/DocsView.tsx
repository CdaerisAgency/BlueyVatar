import Link from 'next/link'
import { GUIDE_HUB, GUIDE_HUB_LEAD, GUIDE_HUB_TITLE } from '../lib/copy/public'
import { docHref, docPages, type DocPage } from '../lib/docs'

/** Sidebar plus rendered page. The HTML comes from our own docs/api markdown at build time. */
export function DocsView({ page, hub = false }: { page: DocPage; hub?: boolean }) {
  const api = docPages().filter((p) => p.group === 'api')
  const guides = docPages().filter((p) => p.group === 'integrations')
  const side = 'inline-flex min-h-11 items-center text-bv-black no-underline hover:text-bv-blue hover:underline'
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-auto flex-col gap-8 px-4 pt-7 pb-14 sm:px-5 md:flex-row md:gap-12 md:pt-10">
      <aside className="md:sticky md:top-6 md:w-60 md:flex-none md:self-start">
        <nav aria-label="Docs" className="text-[15px]">
          <p className="mb-2 font-semibold">API docs</p>
          <ul className="m-0 grid list-none gap-0 p-0">
            {api.map((p) => (
              <li key={p.slug}>
                <Link href={docHref(p.slug)} className={side} aria-current={p.slug === page.slug ? 'page' : undefined}>
                  <span className={p.slug === page.slug ? 'font-semibold text-bv-blue' : ''}>{p.title}</span>
                </Link>
              </li>
            ))}
            <li>
              <a href="https://img.blueyvatar.com/openapi.json" className={side}>OpenAPI (JSON)</a>
            </li>
          </ul>
          <p className="mt-5 mb-2 font-semibold">Integration guides</p>
          <ul className="m-0 grid list-none gap-0 p-0">
            {guides.map((p) => (
              <li key={p.slug}>
                <Link href={docHref(p.slug)} className={side} aria-current={p.slug === page.slug ? 'page' : undefined}>
                  <span className={p.slug === page.slug ? 'font-semibold text-bv-blue' : ''}>{p.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {page.headings.length > 0 && (
          <nav aria-label="On this page" className="mt-6 text-sm">
            <p className="mb-2 font-semibold">On this page</p>
            <ul className="m-0 grid list-none gap-0 p-0">
              {page.headings.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`} className="inline-flex min-h-11 items-center text-bv-ink-3 no-underline hover:text-bv-blue hover:underline">{h.text}</a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </aside>
      <main id="main" tabIndex={-1} className="docs focus:outline-none min-w-0 max-w-[780px] flex-auto">
        {hub && (
          <section aria-labelledby="guide-hub" className="mb-10 border-b border-bv-line pb-8">
            <h2 id="guide-hub" className="m-0 text-2xl font-semibold">{GUIDE_HUB_TITLE}</h2>
            <p className="mt-2 mb-4 text-bv-ink-3">{GUIDE_HUB_LEAD}</p>
            <ul className="m-0 grid list-none gap-0 p-0">
              {GUIDE_HUB.map((g) => (
                <li key={g.slug} className="flex flex-col gap-0.5 border-t border-bv-line py-1 sm:flex-row sm:items-center sm:gap-4">
                  <Link href={docHref(`integrations-${g.slug}`)} className="inline-flex min-h-11 items-center font-semibold text-bv-orange-deep underline hover:text-bv-blue sm:w-36 sm:flex-none">{g.name}</Link>
                  <span className="flex-auto">{g.change}</span>
                  <span className="text-sm text-bv-ink-3">About {g.minutes} minutes</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div dangerouslySetInnerHTML={{ __html: page.html }} />
      </main>
    </div>
  )
}
