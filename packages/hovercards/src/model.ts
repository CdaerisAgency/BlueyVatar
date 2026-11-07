/**
 * Pure logic for the hovercard embed (spec sections 8 and 11.1). No imports, so the embed bundle stays small.
 * Everything returned here is plain text. The embed sets it with textContent, never innerHTML.
 */
export type CardProfile = {
  handle?: string | null
  displayName?: string | null
  pronouns?: string | null
  jobTitle?: string | null
  company?: string | null
  location?: string | null
  avatar?: { url?: string | null } | null
  verifiedAccounts?: { platform?: unknown; service?: unknown; label?: unknown; uri?: unknown; url?: unknown; hidden?: unknown }[] | null
}

export type Card = {
  name: string
  lines: string[]
  avatarUrl: string | null
  profileUrl: string | null
  accounts: string[]
}

const ID = /^[A-Za-z0-9@._:%-]{1,253}$/

/** The value of data-blueyvatar: a handle, a DID, or a SHA256 hash. Anything else is ignored. */
export const cleanId = (raw: string | null | undefined): string | null => {
  const v = (raw ?? '').trim()
  return ID.test(v) ? v : null
}

const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** `api` and `web` are origins. Links and images are rebuilt from known path shapes, so a hostile response cannot inject a URL. */
export function buildCard(p: CardProfile, api: string, web: string): Card {
  const handle = str(p.handle)
  const avatar = str(p.avatar?.url, 500)
  const accounts = (p.verifiedAccounts ?? [])
    // Accounts the user chose to hide are omitted from the card (spec section 8).
    .filter((a) => a && a.hidden !== true)
    .map((a) => str(a.label) || str(a.platform) || str(a.service))
    .filter(Boolean)
    .slice(0, 4)
  return {
    name: str(p.displayName) || handle || 'Profile',
    lines: [str(p.pronouns), [str(p.jobTitle), str(p.company)].filter(Boolean).join(', '), str(p.location)].filter(Boolean),
    avatarUrl: /^\/img\/[A-Za-z0-9._:%/-]+$/.test(avatar) && !avatar.includes('..') ? api + avatar : null,
    profileUrl: /^[A-Za-z0-9.-]{1,253}$/.test(handle) ? `${web}/p/${handle}` : null,
    accounts,
  }
}

/** Delivery profile URL. The token is the publishable key and is required (Business and Enterprise, spec section 11.1). */
export const profileEndpoint = (api: string, id: string, token: string): string => `${api}/profile/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`
