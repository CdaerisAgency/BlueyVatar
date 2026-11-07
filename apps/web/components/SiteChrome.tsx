import Link from 'next/link'
import { COPY } from '../lib/copy'
import { ButtonLink } from './Button'

const inner = 'mx-auto w-full max-w-[1180px] px-4 sm:px-5'

export function SiteNav() {
  const link = 'text-bv-black no-underline hover:text-bv-blue hover:underline'
  return (
    <header>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-bv-pill focus:border-2 focus:border-bv-black focus:bg-bv-orange focus:px-5 focus:py-3 focus:font-semibold focus:text-bv-black focus:no-underline"
      >
        {COPY.nav.skip}
      </a>
      <div className={`${inner} flex flex-wrap items-center justify-between gap-4 py-5`}>
        <Link href="/" className="flex items-center gap-3 font-display text-2xl font-semibold tracking-[-0.01em] text-bv-black no-underline hover:text-bv-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt="" width={44} height={44} className="size-11 rounded-full object-cover" />
          <span>{COPY.brand}</span>
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px] font-medium sm:gap-x-6">
          <Link href="/#how" className={link}>
            {COPY.nav.how}
          </Link>
          <Link href="/#dev" className={link}>
            {COPY.nav.developers}
          </Link>
          <Link href="/pricing" className={link}>
            {COPY.nav.pricing}
          </Link>
          <Link href="/integrations" className={link}>
            {COPY.nav.integrations}
          </Link>
          <ButtonLink href="/login" variant="primary">
            {COPY.nav.signIn}
          </ButtonLink>
        </nav>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t-[1.5px] border-bv-line text-sm text-bv-ink-3">
      <div className={`${inner} flex flex-wrap justify-between gap-x-6 gap-y-3 py-7`}>
        <span>{COPY.footer.tagline}</span>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          {COPY.footer.links.map((l) => (
            <Link key={l.href} href={l.href} className="text-bv-ink-3 no-underline hover:text-bv-blue hover:underline">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}
