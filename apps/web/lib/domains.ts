/**
 * Pure validation for custom profile domains (spec sections 3 row 29 and 11.2).
 * Only subdomains are accepted: Cloudflare for SaaS serves apex domains only with the
 * Enterprise Apex Proxying add-on, so apex owners use the atproto domain-as-handle option.
 * https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/
 */
import { parse } from 'tldts'
import type { Check } from './records'

const ok = <T>(value: T): Check<T> => ({ ok: true, value })
const fail = (error: string): Check<never> => ({ ok: false, error })

export const APEX_MESSAGE =
  'That is a root domain. Custom profile domains work for subdomains such as me.example.com. ' +
  'To use your root domain, set your account handle to that domain instead (look for a change-handle option in the app or on the server that hosts your account). ' +
  'Once your handle is the domain, /p/{domain} on blueyvatar shows your profile.'

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/** Trim, lowercase, and drop one trailing dot. */
export function normalizeHostname(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.$/, '')
}

/**
 * Validate a hostname the user wants to serve their profile from.
 * `reserved` lists hostnames and domain suffixes that belong to the service (for example
 * the app host and the fallback origin); the hostname may not equal or sit under them.
 */
export function validateCustomHostname(raw: string, reserved: readonly string[] = []): Check<string> {
  const host = normalizeHostname(raw)
  if (!host) return fail('Enter the subdomain you own, such as me.example.com.')
  if (/[/:@\s?#]/.test(host)) return fail('Enter only the hostname, without https://, a path, or a port.')
  if (host.length > 253) return fail('That hostname is too long.')
  const labels = host.split('.')
  if (labels.length < 2) return fail('Enter a full hostname such as me.example.com.')
  if (!labels.every((l) => LABEL.test(l))) {
    return fail('Hostnames use letters, digits, and hyphens only. For an international name, enter its xn-- form.')
  }
  const info = parse(host, { allowPrivateDomains: true })
  if (info.isIp) return fail('Enter a hostname, not an IP address.')
  if (!info.domain || !info.publicSuffix || (!info.isIcann && !info.isPrivate)) return fail('That does not look like a public domain name.')
  if (info.hostname === info.publicSuffix) return fail('That is a public suffix, not a domain you can own.')
  if (host === info.domain) return fail(APEX_MESSAGE)
  for (const r of reserved.map(normalizeHostname).filter(Boolean)) {
    if (host === r || host.endsWith(`.${r}`)) return fail('That hostname belongs to blueyvatar and cannot be used.')
  }
  return ok(host)
}

/** True when the hostname is the registrable domain itself (an apex), per the public suffix list. */
export function isApexDomain(raw: string): boolean {
  const info = parse(normalizeHostname(raw), { allowPrivateDomains: true })
  return !!info.domain && info.hostname === info.domain
}
