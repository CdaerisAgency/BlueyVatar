/**
 * Confidential OAuth client metadata (spec sections 10.1 and 14).
 * The client_id is the URL that serves this document. The signing key is
 * stored in Infisical and loaded at runtime; it is never committed.
 */
import { PUSH_APPS } from './push-apps'

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

/** The Bluesky profile collection. Its settings live in the app registry (`push-apps.ts`). */
export const BSKY_PROFILE_COLLECTION = 'app.bsky.actor.profile'

/**
 * The scope that lets blueyvatar write one app's profile record: create and update, limited to that collection.
 * Both actions are needed: the reference PDS checks `create` and `update` on every `putRecord`, even when the
 * record exists (issue #297, https://github.com/bluesky-social/atproto/blob/fe343a1b90c1de470a45b0469628a9e75e7d883f/packages/pds/src/api/com/atproto/repo/putRecord.ts).
 * Never part of the normal sign-in request: it is asked for per app, when the user ticks that app's box.
 */
export const profileWriteScope = (collection: string): string => `repo:${collection}?action=create&action=update`

/**
 * Whether the integrations page is switched on (`OAUTH_PUSH_APPS`). Off by default. Switching it on adds the
 * per-app profile scopes to the OAuth client metadata, which every sign-in sends to the authorization server, and
 * whether Bluesky's server accepts a third-party client that declares them is untested. Test on staging with the
 * owner's account first (docs/deploy.md, "Avatar push permission").
 */
export function pushAppsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.OAUTH_PUSH_APPS?.trim().toLowerCase()
  return v === 'true' || v === '1'
}

/** True when a granted scope string lets blueyvatar both create and update records in `collection`. */
export function grantsProfileWrite(collection: string, granted: string | undefined): boolean {
  for (const token of (granted ?? '').split(/\s+/)) {
    if (token === `repo:${collection}` || token === 'repo:*') return true
    if (!token.startsWith(`repo:${collection}?`)) continue
    const actions = new URLSearchParams(token.slice(token.indexOf('?') + 1)).getAll('action')
    if (actions.length === 0 || (actions.includes('create') && actions.includes('update'))) return true
  }
  return false
}

/**
 * Scopes from spec section 10.1. The permission set bundles the three user-repo collections.
 * `blob:image/*` stays separate because blob permissions cannot be included in a set.
 * account:email is requested only during email linking. Profile scopes of other apps are
 * requested only through `consentScope`, so sign-in for everyone else is unchanged.
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

/** The sign-in scope plus the profile scope of each listed collection: what one app's consent step asks for. It lists the apps already allowed too, so a new grant never drops an earlier one. */
export function consentScope(collections: readonly string[], permissionSet: boolean = usePermissionSet()): string {
  return [signInScope(permissionSet), ...[...new Set(collections)].map(profileWriteScope)].join(' ')
}

export function emailLinkScope(permissionSet: boolean = usePermissionSet()): string {
  return `${signInScope(permissionSet)} account:email`
}

/**
 * Scope declared in the client metadata: everything the client may ever request. The profile scopes
 * are declared only when the integrations page is on (`pushAppsEnabled`), so metadata is unchanged until then.
 */
export function declaredScope(collections: readonly string[] = [], permissionSet: boolean = usePermissionSet(), pushApps: boolean = pushAppsEnabled()): string {
  return pushApps ? `${consentScope(collections, permissionSet)} account:email` : emailLinkScope(permissionSet)
}

const PUSH_COLLECTIONS = PUSH_APPS.map((a) => a.collection)

export function clientMetadata() {
  return {
    client_id: `${PUBLIC_URL}/oauth-client-metadata.json`,
    client_name: 'BlueyVatar',
    client_uri: PUBLIC_URL,
    redirect_uris: [`${PUBLIC_URL}/oauth/callback`],
    scope: declaredScope(PUSH_COLLECTIONS),
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    application_type: 'web',
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256',
    dpop_bound_access_tokens: true,
    jwks_uri: `${PUBLIC_URL}/oauth/jwks.json`,
  }
}
