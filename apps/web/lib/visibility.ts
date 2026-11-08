import { MAX_DOMAINS, parseDomainList } from './keys'

/** Mirrors db/migrations/0001_init.sql visibility_rules and the delivery Visibility type. */
export interface VisibilityRules {
  keyedOnly: boolean
  domainAllowlist: string[]
  hiddenProfile: boolean
  emailLookupOptOut: boolean
}

export const PUBLIC_RULES: VisibilityRules = { keyedOnly: false, domainAllowlist: [], hiddenProfile: false, emailLookupOptOut: false }

export type VisibilityResult = { ok: true; rules: VisibilityRules } | { ok: false; errors: string[] }

/** A checkbox is on when present in the form. `allowlistOn` gates the domain list. */
export function parseVisibilityForm(f: {
  keyedOnly: boolean
  domainAllowlistOn: boolean
  domains: string
  hiddenProfile: boolean
  emailLookupOptOut: boolean
}): VisibilityResult {
  let domainAllowlist: string[] = []
  if (f.domainAllowlistOn) {
    const r = parseDomainList(f.domains)
    if (!r.ok) return r
    if (r.domains.length === 0) return { ok: false, errors: [`Add at least one domain, up to ${MAX_DOMAINS}, or turn the allowlist off.`] }
    domainAllowlist = r.domains
  }
  return {
    ok: true,
    rules: { keyedOnly: f.keyedOnly, domainAllowlist, hiddenProfile: f.hiddenProfile, emailLookupOptOut: f.emailLookupOptOut },
  }
}

export function isPublic(r: VisibilityRules): boolean {
  return !r.keyedOnly && r.domainAllowlist.length === 0 && !r.hiddenProfile
}

export const PUBLIC_DATA_NOTICE =
  "Important limit: these rules apply only to what this service serves. Everything in your atproto repo is public today, so your avatar blob stays readable from your account's home server no matter what you choose here. For real access control you would need an avatar stored by this service outside your repo (you lose portability), or atproto spaces, which are still in alpha. With your permission, blueyvatar can also change the picture on your profile to match your default image, and only that picture."
