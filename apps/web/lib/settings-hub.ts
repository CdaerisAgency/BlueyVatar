/** Every settings route, grouped for /account/settings (issue #152). AccountNav reads the same list to find the current route. */
export type SettingsLink = { href: string; label: string; description: string }
export type SettingsGroup = { title: string; links: SettingsLink[] }

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: 'Profile',
    links: [
      { href: '/account', label: 'Account', description: 'Linked emails, your gallery, and a QR code for your profile.' },
      { href: '/account/avatars', label: 'Avatars', description: 'Upload, import, and choose your default avatar and its rating.' },
      { href: '/account/profile', label: 'Profile', description: 'Job title, location, pronouns, and other public details.' },
      { href: '/account/claims', label: 'Claims', description: 'Verify accounts on other sites and see the atproto apps you use.' },
    ],
  },
  {
    title: 'Privacy',
    links: [
      { href: '/account/visibility', label: 'Visibility', description: 'Choose who can fetch your avatar and profile, and opt out of email lookup.' },
      { href: '/account/notifications', label: 'Notifications', description: 'Pick which emails you get. Security notices always come.' },
    ],
  },
  {
    title: 'Developer',
    links: [
      { href: '/account/keys', label: 'Keys', description: 'Your license, API keys, and usage.' },
      { href: '/account/domain', label: 'Domain', description: 'Serve your profile from your own subdomain (Plus).' },
    ],
  },
  { title: 'Billing', links: [{ href: '/account/billing', label: 'Billing', description: 'Your plan, payment method, and invoices.' }] },
  { title: 'Data', links: [{ href: '/account/data', label: 'Your data', description: 'Download a copy of what we hold, or delete it.' }] },
]

export const SETTINGS_LINKS: SettingsLink[] = SETTINGS_GROUPS.flatMap((g) => g.links)

/** The nav entry for a pathname: an exact match, else the longest entry the path sits under. /account itself only matches exactly. */
export function currentHref(pathname: string, hrefs: readonly string[]): string | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  let best: string | null = null
  for (const h of hrefs) {
    const hit = path === h || (h !== '/account' && path.startsWith(`${h}/`))
    if (hit && (!best || h.length > best.length)) best = h
  }
  return best
}
