/** Trusted PDS hosts for confirmed-email linking (spec section 6, step 3). */
export function parseTrustedHosts(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

export function pdsHost(pdsUrl: string): string | null {
  try {
    return new URL(pdsUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function isTrustedPds(host: string | null, trusted: string[]): boolean {
  return host !== null && trusted.includes(host.toLowerCase())
}

/** A link is created directly only for a confirmed email on a trusted host. */
export function linkMethod(opts: { emailConfirmed: boolean; host: string | null; trusted: string[] }): 'trusted_pds' | 'code' {
  return opts.emailConfirmed && isTrustedPds(opts.host, opts.trusted) ? 'trusted_pds' : 'code'
}
