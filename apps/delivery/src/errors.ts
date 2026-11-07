/** Stable, machine-readable error codes (spec section 7). */
export const DOCS_BASE = 'https://blueyvatar.com/docs/errors'

export type ErrorCode =
  | 'invalid_identifier' | 'invalid_size' | 'invalid_default' | 'default_url_not_allowed'
  | 'invalid_rating' | 'invalid_format' | 'invalid_quality' | 'invalid_ttl'
  | 'invalid_key' | 'license_inactive' | 'origin_not_allowed' | 'rate_limited'
  | 'tier_required' | 'origin_forbidden' | 'not_found' | 'profile_hidden' | 'access_denied' | 'upstream_error'
  | 'invalid_signature' | 'signature_expired'

export function errorBody(code: ErrorCode | string, message: string) {
  return { error: { code, message, docs: `${DOCS_BASE}#${code}` } }
}
