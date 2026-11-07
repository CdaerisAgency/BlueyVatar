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

/**
 * Scopes from spec section 10.1. The permission set bundles the three user-repo collections.
 * `blob:image/*` stays separate because blob permissions cannot be included in a set.
 * account:email is requested only during email linking.
 */
export function signInScope(permissionSet: boolean = usePermissionSet()): string {
  return [
    'atproto',
    ...(permissionSet
      ? [`include:${PERMISSION_SET_NSID}`]
      : ['repo:com.blueyvatar.image', 'repo:com.blueyvatar.profile', 'repo:com.blueyvatar.claim']),
    'blob:image/*',
  ].join(' ')
}
export function emailLinkScope(permissionSet: boolean = usePermissionSet()): string {
  return `${signInScope(permissionSet)} account:email`
}

export function clientMetadata() {
  return {
    client_id: `${PUBLIC_URL}/oauth-client-metadata.json`,
    client_name: 'blueyvatar',
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
