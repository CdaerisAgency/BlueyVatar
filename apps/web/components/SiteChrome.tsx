import Link from 'next/link'
import { COPY } from '../lib/copy'

export function SiteNav() {
  return (
    <header>
      <div className="bv-inner bv-nav">
        <Link href="/" className="bv-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt="" width={44} height={44} />
          <span>{COPY.brand}</span>
        </Link>
        <nav aria-label="Main" className="bv-navlinks">
          <Link href="/#how">{COPY.nav.how}</Link>
          <Link href="/#dev">{COPY.nav.developers}</Link>
          <Link href="/#pricing">{COPY.nav.pricing}</Link>
          <Link href="/login" className="bv-btn bv-primary">
            {COPY.nav.signIn}
          </Link>
        </nav>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="bv-footer">
      <div className="bv-inner">
        <span>{COPY.footer.tagline}</span>
        <nav aria-label="Footer">
          {COPY.footer.links.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}
