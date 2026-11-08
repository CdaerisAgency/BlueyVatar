'use client'

import Link from 'next/link'
import { COPY } from '../lib/copy'
import { useViewer } from './useViewer'

/** Footer links. The "Sign in" link is dropped once someone is signed in. */
export default function FooterLinks() {
  const v = useViewer()
  const links = COPY.footer.links.filter((l) => !(v.signedIn && l.href === '/login'))
  return (
    <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="text-bv-ink-3 no-underline hover:text-bv-blue hover:underline">
          {l.label}
        </Link>
      ))}
    </nav>
  )
}
