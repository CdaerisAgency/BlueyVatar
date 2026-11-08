/** Stable, machine-readable error codes (spec section 7). */
export const DOCS_BASE = 'https://blueyvatar.com/docs/errors'

export const ERROR_CODES = [
  'invalid_identifier', 'invalid_size', 'invalid_default', 'default_url_not_allowed',
  'invalid_rating', 'invalid_format', 'invalid_quality', 'invalid_ttl', 'invalid_platform',
  'invalid_key', 'license_inactive', 'origin_not_allowed', 'rate_limited',
  'tier_required', 'origin_forbidden', 'not_found', 'internal', 'access_denied', 'upstream_error',
  'invalid_signature', 'signature_expired', 'not_ready', 'overloaded', 'secret_key_required', 'key_expired',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export function errorBody(code: ErrorCode | string, message: string, requestId?: string) {
  return { error: { code, message, docs: `${DOCS_BASE}#${code}`, ...(requestId ? { request_id: requestId } : {}) } }
}
