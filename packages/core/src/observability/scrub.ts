import { createHash } from 'node:crypto'

/** Field names whose values are never logged or sent to the error tracker. */
const SENSITIVE_KEY = /authorization|api[-_]?key|x-api-key|token|cookie|password|passwd|secret|jwk|private|signature|email/i

const REDACTED = '[redacted]'
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const BEARER_IN_TEXT = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi
const QUERY_SECRET_IN_TEXT = /([?&;\s](?:token|key|api[-_]?key|sig|signature|access_token|code)=)[^&\s"']+/gi

/** First 16 hex characters of SHA256(did). Enough to correlate log lines without naming the account. */
export function didHash(did: string): string {
  return createHash('sha256').update(did).digest('hex').slice(0, 16)
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key)
}

/** Removes emails, bearer credentials, and secret-looking query values from free text. */
export function scrubText(text: string): string {
  return text.replace(BEARER_IN_TEXT, '$1 ' + REDACTED).replace(QUERY_SECRET_IN_TEXT, '$1' + REDACTED).replace(EMAIL_IN_TEXT, '[email]')
}

/**
 * Deep-copies a value for logging or reporting. Sensitive keys are replaced, a `did` key becomes
 * `didHash`, errors become name and message, and strings are scrubbed. Depth and size are bounded.
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return scrubText(value.length > 2000 ? value.slice(0, 2000) + '...' : value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  if (value instanceof Error) return { name: value.name, message: scrubText(value.message) }
  if (depth >= 4) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubValue(v, depth + 1))
  if (value instanceof Uint8Array) return `[bytes ${value.byteLength}]`
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    if (k === 'did' && typeof v === 'string') out.didHash = didHash(v)
    else if (isSensitiveKey(k)) out[k] = REDACTED
    else out[k] = scrubValue(v, depth + 1)
  }
  return out
}

/** Header map copy with sensitive headers replaced. Names are lowercased. */
export function scrubHeaders(headers: Record<string, string | string[] | undefined> | Headers): Record<string, string> {
  const out: Record<string, string> = {}
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers)
  for (const [name, v] of entries) {
    if (v === undefined) continue
    const key = name.toLowerCase()
    out[key] = isSensitiveKey(key) ? REDACTED : scrubText(Array.isArray(v) ? v.join(',') : v)
  }
  return out
}

/** Removes secret query values from a URL and drops the fragment. */
export function scrubUrl(raw: string): string {
  try {
    const u = new URL(raw, 'http://placeholder.invalid')
    for (const k of [...u.searchParams.keys()]) if (isSensitiveKey(k) || k === 'sig' || k === 'code') u.searchParams.set(k, REDACTED)
    const s = raw.startsWith('http') ? u.origin + u.pathname + u.search : u.pathname + u.search
    return s
  } catch {
    return scrubText(raw)
  }
}
