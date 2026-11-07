import { ATPROTO_APPS, PLATFORM_LABELS, type Platform } from '@blueyvatar/core'
import { platformAvailable } from './claim-providers'

type Env = Record<string, string | undefined>

/** Platforms verified by signing in at the platform. Some are switched off until the platform's app review is done. */
export const SIGN_IN_PLATFORMS: readonly Platform[] = ['github', 'mastodon', 'twitch', 'youtube', 'instagram', 'threads', 'tiktok']

export interface SignInEntry { platform: Platform; name: string; live: boolean }

export function signInEntries(env: Env = process.env): SignInEntry[] {
  return SIGN_IN_PLATFORMS.map((platform) => ({
    platform,
    name: PLATFORM_LABELS[platform] ?? platform,
    // Instagram stays usable through the page check, but its sign-in is the part that is coming.
    live: platform === 'instagram' ? platformAvailable('instagram', env) && instagramSignIn(env) : platformAvailable(platform, env),
  }))
}

const instagramSignIn = (env: Env): boolean => env.VERIFY_INSTAGRAM_ENABLED === 'true' && !!env.INSTAGRAM_APP_ID && !!env.INSTAGRAM_APP_SECRET

export const PROOF_METHODS = [
  { name: 'Website', how: 'Add a link to your blueyvatar profile on your page with rel="me". blueyvatar checks that the link is there.' },
  { name: 'Domain', how: 'Add a DNS TXT record that names your account. Only the person who controls the domain can add it.' },
  { name: 'Bluesky', how: 'Your own Bluesky account verifies at once. For a second account, put a proof line in its bio.' },
  { name: 'X and Instagram pages', how: 'Link back with rel="me" from the profile page. These platforms may hide bio links from crawlers, so a check can fail.' },
] as const

export const ATPROTO_APP_LIST = ATPROTO_APPS
