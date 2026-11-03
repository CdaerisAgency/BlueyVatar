/**
 * Claim normalization and verification methods (spec sections 5 and 8, issues #28 and #51).
 * A claim record's uri is always the canonical https URL of the account, so the same account
 * entered two ways produces one claim.
 */
import { isPublicHostname, parseSafeHttpsUrl } from './safe-url'

export const CLAIM_COLLECTION = 'com.blueyvatar.claim'
export const ATTESTATION_COLLECTION = 'com.blueyvatar.attestation'
export const MAX_CLAIMS = 20

export const PLATFORMS = ['github', 'mastodon', 'website', 'instagram', 'x'] as const
export type Platform = (typeof PLATFORMS)[number]
/** In the lexicon's knownValues but not verifiable yet. The UI shows "coming later". */
export const COMING_LATER = ['tiktok', 'threads'] as const

export const PLATFORM_LABELS: Record<string, string> = {
  github: 'GitHub', mastodon: 'Mastodon', website: 'Website', instagram: 'Instagram', x: 'X', tiktok: 'TikTok', threads: 'Threads',
}

export type Method = 'github-oauth' | 'mastodon-oauth' | 'rel-me'
export const METHOD_FOR: Record<Platform, Method> = {
  github: 'github-oauth', mastodon: 'mastodon-oauth', website: 'rel-me', instagram: 'rel-me', x: 'rel-me',
}

export const isPlatform = (v: unknown): v is Platform => typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v)

export type ClaimRecord = { platform: string; uri: string; hidden?: boolean; createdAt: string }
type Check<T> = { ok: true; value: T } | { ok: false; error: string }
const ok = <T>(value: T): Check<T> => ({ ok: true, value })
const fail = (error: string): Check<never> => ({ ok: false, error })

const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i
const INSTAGRAM_USER = /^(?!.*\.\.)[A-Za-z0-9._]{1,30}$/
const X_USER = /^[A-Za-z0-9_]{1,15}$/
const MASTODON_USER = /^[a-z0-9_][a-z0-9_.-]{0,63}$/i

const tryUrl = (s: string): URL | null => {
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
}

/** The account name from either a bare name or a profile URL on one of `hosts`. */
function accountName(input: string, hosts: string[]): string | null {
  const s = input.trim()
  if (!s) return null
  if (!/[/.]/.test(s) || s.startsWith('@')) return s.replace(/^@/, '')
  const u = tryUrl(s)
  if (!u || !hosts.includes(u.hostname.toLowerCase())) return null
  return decodeURIComponent(u.pathname.split('/').filter(Boolean)[0] ?? '').replace(/^@/, '') || null
}

export function mastodonUri(instance: string, user: string): string {
  return `https://${instance.toLowerCase()}/@${user.toLowerCase()}`
}

/** Splits a Mastodon claim uri into instance and user, or null when it is not one. */
export function parseMastodonUri(uri: string): { instance: string; user: string } | null {
  const u = parseSafeHttpsUrl(uri)
  const m = u && /^\/@([^/]+)\/?$/.exec(u.pathname)
  return u && m && MASTODON_USER.test(m[1] ?? '') ? { instance: u.hostname.toLowerCase(), user: (m[1] ?? '').toLowerCase() } : null
}

export function normalizeClaim(platform: string, input: string): Check<{ platform: Platform; uri: string }> {
  const raw = input.trim()
  if (!isPlatform(platform)) {
    return fail((COMING_LATER as readonly string[]).includes(platform) ? `${PLATFORM_LABELS[platform]} verification is coming later.` : 'Choose a platform from the list.')
  }
  if (!raw || raw.length > 300) return fail('Enter an account name or address.')
  switch (platform) {
    case 'github': {
      const name = accountName(raw, ['github.com', 'www.github.com'])
      if (!name || !GITHUB_LOGIN.test(name)) return fail('Enter a GitHub username or a github.com profile URL.')
      return ok({ platform, uri: `https://github.com/${name}` })
    }
    case 'instagram': {
      const name = accountName(raw, ['instagram.com', 'www.instagram.com'])
      if (!name || !INSTAGRAM_USER.test(name)) return fail('Enter an Instagram username or profile URL.')
      return ok({ platform, uri: `https://www.instagram.com/${name.toLowerCase()}` })
    }
    case 'x': {
      const name = accountName(raw, ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'])
      if (!name || !X_USER.test(name)) return fail('Enter an X username or profile URL.')
      return ok({ platform, uri: `https://x.com/${name.toLowerCase()}` })
    }
    case 'mastodon': {
      const at = /^@?([^@\s/]+)@([^@\s/]+)$/.exec(raw)
      let user = at?.[1]
      let host = at?.[2]
      if (!at) {
        const u = tryUrl(raw)
        const m = u && /^\/@([^/]+)\/?$/.exec(u.pathname)
        if (u && m) [user, host] = [m[1], u.hostname]
      }
      if (!user || !host || !MASTODON_USER.test(user) || !isPublicHostname(host)) return fail('Enter a Mastodon address like @name@instance.social or a profile URL.')
      return ok({ platform, uri: mastodonUri(host, user) })
    }
    case 'website': {
      const u = parseSafeHttpsUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
      if (!u) return fail('Enter a public https address.')
      u.hash = ''
      return ok({ platform, uri: u.href })
    }
  }
}

/** The link the user's page must carry with rel="me" (PUBLIC_URL based). */
export const profileLinkFor = (publicUrl: string, handle: string): string => `${publicUrl.replace(/\/+$/, '')}/p/${handle}`

/** Display label for a claim, for profile JSON consumers and the dashboard. */
export function claimLabel(platform: string, uri: string): string {
  try {
    const u = new URL(uri)
    const first = u.pathname.split('/').filter(Boolean)[0] ?? ''
    if (platform === 'mastodon') return `${first.replace(/^@/, '')}@${u.hostname}`
    if (platform === 'website') return u.hostname
    return `${PLATFORM_LABELS[platform] ?? platform} ${first}`.trim()
  } catch {
    return PLATFORM_LABELS[platform] ?? platform
  }
}

/** The stored claim still matches what was verified. Attestations are bound to platform and uri. */
export const claimMatches = (a: { platform: string; uri: string }, b: { platform: string; uri: string }): boolean => a.platform === b.platform && a.uri === b.uri
