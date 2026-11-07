/**
 * Claim normalization and verification methods (spec sections 5 and 8, issues #28 and #51).
 * A claim record's uri is always the canonical https URL of the account, so the same account
 * entered two ways produces one claim.
 */
import { isPublicHostname, parseSafeHttpsUrl } from './safe-url.js'

export const CLAIM_COLLECTION = 'com.blueyvatar.claim'
export const ATTESTATION_COLLECTION = 'com.blueyvatar.attestation'
export const MAX_CLAIMS = 20

export const PLATFORMS = ['github', 'mastodon', 'website', 'domain', 'bluesky', 'instagram', 'threads', 'tiktok', 'youtube', 'twitch', 'x'] as const
export type Platform = (typeof PLATFORMS)[number]

export const PLATFORM_LABELS: Record<string, string> = {
  github: 'GitHub', mastodon: 'Mastodon', website: 'Website', domain: 'Domain', bluesky: 'Bluesky', instagram: 'Instagram', x: 'X',
  tiktok: 'TikTok', threads: 'Threads', youtube: 'YouTube', twitch: 'Twitch',
}

export type Method =
  | 'github-oauth' | 'mastodon-oauth' | 'rel-me' | 'dns-txt' | 'bsky-proof'
  | 'instagram-oauth' | 'threads-oauth' | 'tiktok-oauth' | 'youtube-oauth' | 'twitch-oauth'
/** The default method per platform. Instagram uses OAuth instead when its provider is enabled (see methodFor). */
export const METHOD_FOR: Record<Platform, Method> = {
  github: 'github-oauth', mastodon: 'mastodon-oauth', website: 'rel-me', domain: 'dns-txt', bluesky: 'bsky-proof',
  instagram: 'rel-me', threads: 'threads-oauth', tiktok: 'tiktok-oauth', youtube: 'youtube-oauth', twitch: 'twitch-oauth', x: 'rel-me',
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
const TIKTOK_USER = /^(?!.*\.$)[A-Za-z0-9_.]{2,24}$/
const THREADS_USER = INSTAGRAM_USER
const TWITCH_USER = /^[a-z0-9_]{4,25}$/i
const YOUTUBE_CHANNEL = /^UC[\w-]{22}$/
const BSKY_HANDLE = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const DID = /^did:(?:plc:[a-z2-7]{24}|web:[a-z0-9.-]+)$/

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
  if (s.startsWith('@')) return s.slice(1)
  // A bare name may contain dots (Instagram, TikTok). Only a bare host of the platform itself is not a name.
  if (!s.includes('/')) return hosts.includes(s.toLowerCase()) ? null : s
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
    return fail('Choose a platform from the list.')
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
    case 'bluesky': {
      const prof = /^(?:https?:\/\/)?(?:www\.)?bsky\.app\/profile\/([^/?#]+)/i.exec(raw)
      const name = (prof?.[1] ?? raw).replace(/^@/, '').toLowerCase()
      if (!BSKY_HANDLE.test(name) && !DID.test(name)) return fail('Enter a Bluesky handle like name.bsky.social or a bsky.app profile URL.')
      return ok({ platform, uri: `https://bsky.app/profile/${name}` })
    }
    case 'domain': {
      const u = tryUrl(raw)
      const host = u?.hostname.toLowerCase()
      if (!u || !host || !isPublicHostname(host)) return fail('Enter a public domain name like example.com.')
      return ok({ platform, uri: `https://${host}` })
    }
    case 'tiktok': {
      const name = accountName(raw, ['tiktok.com', 'www.tiktok.com'])
      if (!name || !TIKTOK_USER.test(name)) return fail('Enter a TikTok username or profile URL.')
      return ok({ platform, uri: `https://www.tiktok.com/@${name.toLowerCase()}` })
    }
    case 'threads': {
      const name = accountName(raw, ['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'])
      if (!name || !THREADS_USER.test(name)) return fail('Enter a Threads username or profile URL.')
      return ok({ platform, uri: `https://www.threads.com/@${name.toLowerCase()}` })
    }
    case 'twitch': {
      const name = accountName(raw, ['twitch.tv', 'www.twitch.tv'])
      if (!name || !TWITCH_USER.test(name)) return fail('Enter a Twitch username or channel URL.')
      return ok({ platform, uri: `https://www.twitch.tv/${name.toLowerCase()}` })
    }
    case 'youtube': {
      const m = /^(?:(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/channel\/)?(UC[\w-]{22})\/?$/.exec(raw)
      if (!m || !YOUTUBE_CHANNEL.test(m[1] ?? '')) return fail('Enter a YouTube channel address like youtube.com/channel/UC... (the channel ID, not an @handle).')
      return ok({ platform, uri: `https://www.youtube.com/channel/${m[1]}` })
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
    if (platform === 'website' || platform === 'domain') return u.hostname
    if (platform === 'bluesky') return decodeURIComponent(u.pathname.split('/').filter(Boolean)[1] ?? '') || 'Bluesky'
    if (platform === 'youtube') return 'YouTube channel'
    return `${PLATFORM_LABELS[platform] ?? platform} ${first}`.trim()
  } catch {
    return PLATFORM_LABELS[platform] ?? platform
  }
}

/** The stored claim still matches what was verified. Attestations are bound to platform and uri. */
export const claimMatches = (a: { platform: string; uri: string }, b: { platform: string; uri: string }): boolean => a.platform === b.platform && a.uri === b.uri
