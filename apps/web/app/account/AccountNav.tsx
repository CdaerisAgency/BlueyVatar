import Link from 'next/link'

const LINKS = [
  ['/account', 'Account'],
  ['/account/avatars', 'Avatars'],
  ['/account/profile', 'Profile'],
  ['/account/keys', 'Keys'],
  ['/account/visibility', 'Visibility'],
  ['/account/domain', 'Domain'],
] as const

export default function AccountNav() {
  return (
    <nav aria-label="Account" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href}>
          {label}
        </Link>
      ))}
    </nav>
  )
}
