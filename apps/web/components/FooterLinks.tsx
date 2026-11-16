'use client'

import Link from 'next/link'
import { footerLinksFor } from '../lib/chrome'
import { COPY } from '../lib/copy'
import { useViewer } from './useViewer'

/** Footer links. The "Sign in" link is dropped once someone is signed in. */
export default function FooterLinks() {
  const v = useViewer()
  const links = footerLinksFor(COPY.footer.links, v.signedIn)
  return (
    <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-0">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center text-bv-ink-3 no-underline hover:text-bv-blue hover:underline">
          {l.label}
        </Link>
      ))}
    </nav>
  )
}
