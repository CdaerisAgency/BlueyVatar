/**
 * Confidential OAuth client metadata (spec sections 10.1 and 14).
 * The client_id is the URL that serves this document. The signing key is
 * stored in Infisical and loaded at runtime; it is never committed.
 */
export const PUBLIC_URL = process.env.PUBLIC_URL ?? 'https://blueyvatar.com'

/** Scopes from spec section 10.1. account:email is requested only during email linking. */
export const SIGN_IN_SCOPE = [
  'atproto',
  'repo:com.blueyvatar.image',
  'repo:com.blueyvatar.profile',
  'repo:com.blueyvatar.claim',
  'blob:image/*',
].join(' ')
export const EMAIL_LINK_SCOPE = `${SIGN_IN_SCOPE} account:email`

export function clientMetadata() {
  return {
    client_id: `${PUBLIC_URL}/oauth-client-metadata.json`,
    client_name: 'blueyvatar',
    client_uri: PUBLIC_URL,
    redirect_uris: [`${PUBLIC_URL}/oauth/callback`],
    scope: EMAIL_LINK_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    application_type: 'web',
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256',
    dpop_bound_access_tokens: true,
    jwks_uri: `${PUBLIC_URL}/oauth/jwks.json`,
  }
}
