'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { currentHref } from '../../lib/settings-hub'

const LINKS = [
  ['/account', 'Account'],
  ['/account/settings', 'Settings'],
  ['/account/avatars', 'Avatars'],
  ['/account/profile', 'Profile'],
  ['/account/keys', 'Keys'],
  ['/account/orgs', 'Organizations'],
  ['/account/billing', 'Billing'],
  ['/account/claims', 'Claims'],
  ['/account/visibility', 'Visibility'],
  ['/account/domain', 'Domain'],
  ['/account/data', 'Your data'],
  ['/account/notifications', 'Notifications'],
] as const

export default function AccountNav() {
  const current = currentHref(usePathname() ?? '', LINKS.map(([h]) => h))
  return (
    <nav aria-label="Account" className="mb-7 flex flex-wrap gap-2">
      {LINKS.map(([href, label]) => {
        const on = href === current
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? 'page' : undefined}
            className={`rounded-bv-pill border-[1.5px] px-4 py-2 text-[15px] font-medium no-underline hover:border-bv-black hover:text-bv-blue ${on ? 'border-bv-black bg-bv-black text-bv-white hover:text-bv-white' : 'border-bv-line bg-bv-white text-bv-black'}`}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
