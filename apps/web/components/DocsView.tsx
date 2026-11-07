import Link from 'next/link'
import { docHref, docPages, type DocPage } from '../lib/docs'

/** Sidebar plus rendered page. The HTML comes from our own docs/api markdown at build time. */
export function DocsView({ page }: { page: DocPage }) {
  const pages = docPages()
  const side = 'text-bv-black no-underline hover:text-bv-blue hover:underline'
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-auto flex-col gap-8 px-4 pt-7 pb-14 sm:px-5 md:flex-row md:gap-12 md:pt-10">
      <aside className="md:sticky md:top-6 md:w-60 md:flex-none md:self-start">
        <nav aria-label="Docs" className="text-[15px]">
          <p className="mb-2 font-semibold">API docs</p>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {pages.map((p) => (
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
        </nav>
        {page.headings.length > 0 && (
          <nav aria-label="On this page" className="mt-6 text-sm">
            <p className="mb-2 font-semibold">On this page</p>
            <ul className="m-0 grid list-none gap-1 p-0">
              {page.headings.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`} className="text-bv-ink-3 no-underline hover:text-bv-blue hover:underline">{h.text}</a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </aside>
      <main id="main" tabIndex={-1} className="docs focus:outline-none min-w-0 max-w-[780px] flex-auto">
        <div dangerouslySetInnerHTML={{ __html: page.html }} />
      </main>
    </div>
  )
}
