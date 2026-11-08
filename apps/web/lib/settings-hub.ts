/** Every settings route, grouped for /account/settings (issue #152). The account side menu has its own model in account-nav.ts. Settings itself lives in the profile menu. */
export type SettingsLink = { href: string; label: string; description: string }
export type SettingsGroup = { title: string; links: SettingsLink[] }

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: 'Profile',
    links: [
      { href: '/account', label: 'Account', description: 'Linked emails, your gallery, and a QR code for your profile.' },
      { href: '/account/avatars', label: 'Avatars', description: 'Upload, import, and choose your default avatar and its rating.' },
      { href: '/account/profile', label: 'Profile', description: 'Job title, location, pronouns, and other public details.' },
      { href: '/account/stats', label: 'Profile views', description: 'Daily profile views for the last 30 days (Plus).' },
      { href: '/account/claims', label: 'Verified accounts', description: 'Verify accounts on other sites and see the atproto apps you use.' },
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
      { href: '/account/keys', label: 'API keys and license', description: 'Your license, API keys, and usage.' },
      { href: '/account/domain', label: 'Custom profile domain', description: 'Serve your profile from your own subdomain (Plus).' },
    ],
  },
  { title: 'Billing', links: [{ href: '/account/billing', label: 'Plan and billing', description: 'Your plan, payment method, and invoices.' }] },
]

/** Shown last on the settings page, styled as destructive. */
export const DANGER_ZONE: SettingsLink = { href: '/account/settings/danger', label: 'Danger zone', description: 'Download a copy of what we store, or delete it.' }

export const SETTINGS_LINKS: SettingsLink[] = [...SETTINGS_GROUPS.flatMap((g) => g.links), DANGER_ZONE]

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
