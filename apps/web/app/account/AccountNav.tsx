import Link from 'next/link'

const LINKS = [
  ['/account', 'Account'],
  ['/account/avatars', 'Avatars'],
  ['/account/profile', 'Profile'],
  ['/account/keys', 'Keys'],
  ['/account/billing', 'Billing'],
  ['/account/claims', 'Claims'],
  ['/account/visibility', 'Visibility'],
  ['/account/domain', 'Domain'],
  ['/account/data', 'Your data'],
  ['/account/notifications', 'Notifications'],
] as const

export default function AccountNav() {
  return (
    <nav aria-label="Account" className="mb-7 flex flex-wrap gap-2">
      {LINKS.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          className="rounded-bv-pill border-[1.5px] border-bv-line bg-bv-white px-4 py-2 text-[15px] font-medium text-bv-black no-underline hover:border-bv-black hover:text-bv-blue"
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}
