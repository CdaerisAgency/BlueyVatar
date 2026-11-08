import { currentHref } from './settings-hub'

/** The account side menu (issue #243). Pure data and logic so the client menu can import it and tests can run without a DOM. Two levels at most: groups, then pages. */
export type NavItem = { href: string; label: string }
export type NavGroup = { id: string; label: string; items: NavItem[] }

/** Each label is exactly the page's visible h1. account-nav.test.ts checks that against the page source. */
export const ACCOUNT_NAV: NavGroup[] = [
  {
    id: 'profile',
    label: 'Profile',
    items: [
      { href: '/account/profile', label: 'Profile' },
      { href: '/account/avatars', label: 'Avatars' },
      { href: '/account/visibility', label: 'Visibility' },
    ],
  },
  {
    id: 'identity',
    label: 'Identity',
    items: [
      { href: '/account/claims', label: 'Verified accounts' },
      { href: '/account/verify', label: 'Verify' },
      { href: '/account/domain', label: 'Custom profile domain' },
    ],
  },
  { id: 'developers', label: 'Developers', items: [{ href: '/account/keys', label: 'API keys and license' }] },
  { id: 'billing', label: 'Billing', items: [{ href: '/account/billing', label: 'Plan and billing' }] },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { href: '/account/notifications', label: 'Notifications' },
      { href: '/account/settings', label: 'Sign-out options' },
      { href: '/account/settings/danger', label: 'Danger zone' },
    ],
  },
]

export const NAV_STORAGE_KEY = 'bv-account-nav-open'

export function allItems(groups: readonly NavGroup[] = ACCOUNT_NAV): NavItem[] {
  return groups.flatMap((g) => g.items)
}

/** The menu page for a pathname, or null for pages outside the menu (such as /account). Sub-pages such as /account/avatars/import count as their parent. */
export function currentItemHref(pathname: string, groups: readonly NavGroup[] = ACCOUNT_NAV): string | null {
  return currentHref(pathname, allItems(groups).map((i) => i.href))
}

/** The id of the group that holds a page, or null. */
export function groupIdFor(href: string | null, groups: readonly NavGroup[] = ACCOUNT_NAV): string | null {
  if (!href) return null
  return groups.find((g) => g.items.some((i) => i.href === href))?.id ?? null
}

/** Groups to show open: whatever the viewer left open, plus the group with the current page, which is always open. */
export function openGroupIds(pathname: string, stored: readonly string[] | null, groups: readonly NavGroup[] = ACCOUNT_NAV): string[] {
  const known = new Set(groups.map((g) => g.id))
  const open = new Set((stored ?? []).filter((id) => known.has(id)))
  const here = groupIdFor(currentItemHref(pathname, groups), groups)
  if (here) open.add(here)
  return groups.map((g) => g.id).filter((id) => open.has(id))
}

/** Read the saved list defensively. Anything unexpected means "no saved state". */
export function parseStoredOpen(raw: string | null): string[] | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null
  } catch {
    return null
  }
}

/** Next index for arrow-key movement among `count` visible controls. Wraps at both ends. */
export function nextIndex(index: number, count: number, key: string): number {
  if (count <= 0) return -1
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowDown') return index < 0 ? 0 : (index + 1) % count
  if (key === 'ArrowUp') return index < 0 ? count - 1 : (index - 1 + count) % count
  return index
}
