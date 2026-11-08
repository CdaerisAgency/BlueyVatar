import { avatarUrl } from './avatar-snippets'

/**
 * The public host of the delivery service, which serves `/avatar/{hash}`. The web host has no such route, so a URL built on
 * `PUBLIC_URL` (blueyvatar.com) answers "Page not found" (issue #223 items 7 and 8). Same fallback as the profile pages.
 */
export function publicDeliveryBase(env: Record<string, string | undefined> = process.env): string {
  return env.PUBLIC_DELIVERY_URL || env.DELIVERY_URL || 'http://localhost:3001'
}

/** The avatar URL shown to the owner for their primary email hash. Delivery answers an unlinked or avatar-less hash with its default-avatar redirect, never a 404. */
export function ownerAvatarUrl(emailHash: string, env?: Record<string, string | undefined>): string {
  return avatarUrl(publicDeliveryBase(env), emailHash)
}
