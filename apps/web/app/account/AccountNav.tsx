import Link from 'next/link'

const LINKS = [
  ['/account', 'Account'],
  ['/account/avatars', 'Avatars'],
  ['/account/profile', 'Profile'],
  ['/account/keys', 'Keys'],
  ['/account/claims', 'Claims'],
  ['/account/visibility', 'Visibility'],
  ['/account/domain', 'Domain'],
] as const

export default function AccountNav() {
  return (
    <nav aria-label="Account" className="bv-subnav">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href}>
          {label}
        </Link>
      ))}
    </nav>
  )
}
