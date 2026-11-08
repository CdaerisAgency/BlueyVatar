/**
 * Confidential OAuth client metadata (spec sections 10.1 and 14).
 * The client_id is the URL that serves this document. The signing key is
 * stored in Infisical and loaded at runtime; it is never committed.
 */
export const PUBLIC_URL = process.env.PUBLIC_URL ?? 'https://blueyvatar.com'

/** NSID of the permission set published by tools/lexicon (docs/deploy.md, "Publish the lexicons"). */
export const PERMISSION_SET_NSID = 'com.blueyvatar.authFull'

/**
 * Switches the requested scope from three `repo:` scopes to `include:<permission set>`. Off by
 * default: an `include:` scope fails at the authorization server until the set is published and
 * `_lexicon.blueyvatar.com` resolves (https://atproto.com/specs/permission, "Resolution and Caching").
 */
export function usePermissionSet(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.OAUTH_USE_PERMISSION_SET?.trim().toLowerCase()
  return v === 'true' || v === '1'
}

/** The one collection blueyvatar may change that it does not own: the user's Bluesky profile (spec section 10.1). */
export const BSKY_PROFILE_COLLECTION = 'app.bsky.actor.profile'
/** Only `update`: blueyvatar never creates or deletes the Bluesky profile record. */
export const BSKY_PROFILE_SCOPE = `repo:${BSKY_PROFILE_COLLECTION}?action=update`

/**
 * Adds the Bluesky profile scope to the sign-in request. Off by default: whether Bluesky's authorization
 * server lets a third-party app ask for write access to an `app.bsky.*` collection is untested, and a refused
 * scope would break sign-in for everyone. Test on staging with the owner's account first (docs/deploy.md).
 */
export function useBskyProfileScope(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.OAUTH_REQUEST_BSKY_PROFILE?.trim().toLowerCase()
  return v === 'true' || v === '1'
}

/** True when a granted scope string lets blueyvatar update the Bluesky profile record. */
export function grantsBskyProfileUpdate(granted: string | undefined): boolean {
  for (const token of (granted ?? '').split(/\s+/)) {
    if (token === `repo:${BSKY_PROFILE_COLLECTION}` || token === 'repo:*') return true
    if (!token.startsWith(`repo:${BSKY_PROFILE_COLLECTION}?`)) continue
    const actions = new URLSearchParams(token.slice(token.indexOf('?') + 1)).getAll('action')
    if (actions.length === 0 || actions.includes('update')) return true
  }
  return false
}

/**
 * Scopes from spec section 10.1. The permission set bundles the three user-repo collections.
 * `blob:image/*` stays separate because blob permissions cannot be included in a set.
 * account:email is requested only during email linking.
 */
export function signInScope(permissionSet: boolean = usePermissionSet(), bskyProfile: boolean = useBskyProfileScope()): string {
  return [
    'atproto',
    ...(permissionSet
      ? [`include:${PERMISSION_SET_NSID}`]
      : ['repo:com.blueyvatar.image', 'repo:com.blueyvatar.profile', 'repo:com.blueyvatar.claim']),
    ...(bskyProfile ? [BSKY_PROFILE_SCOPE] : []),
    'blob:image/*',
  ].join(' ')
}
export function emailLinkScope(permissionSet: boolean = usePermissionSet(), bskyProfile: boolean = useBskyProfileScope()): string {
  return `${signInScope(permissionSet, bskyProfile)} account:email`
}

export function clientMetadata() {
  return {
    client_id: `${PUBLIC_URL}/oauth-client-metadata.json`,
    client_name: 'BlueyVatar',
    client_uri: PUBLIC_URL,
    redirect_uris: [`${PUBLIC_URL}/oauth/callback`],
    scope: emailLinkScope(),
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    application_type: 'web',
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256',
    dpop_bound_access_tokens: true,
    jwks_uri: `${PUBLIC_URL}/oauth/jwks.json`,
  }
}
