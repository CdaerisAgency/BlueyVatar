import type { LinkRow } from './store'
import { decryptJson } from './token-crypto'

/** The domain of an address masked the way `maskEmail` masks it: blueyvatar.com becomes b***.com. */
export function maskDomain(domain: string): string {
  const dot = domain.indexOf('.')
  const host = dot === -1 ? domain : domain.slice(0, dot)
  const tld = dot === -1 ? '' : domain.slice(dot)
  return `${host.slice(0, 1)}***${tld}`
}

export type LinkedEmailView = {
  /** The full address (for the signed-in owner) or a masked form such as `***@cdaeris.com`. */
  text: string
  /** True when `text` is the full address. */
  full: boolean
  method: string
  primary: boolean
}

/**
 * What the owner sees for each linked email. Every link made since migration 0037 keeps its address encrypted, so it is
 * shown in full. Older links keep only a hash and a domain: they are masked, with a prompt to link the address again. The primary email falls back to the copy kept for notices.
 */
export function describeLinkedEmails(
  links: LinkRow[],
  primaryAddress: string | null,
  decrypt: (enc: string) => string = (e) => decryptJson<string>(e),
): LinkedEmailView[] {
  return links.map((l) => {
    const stored = readPrimaryAddress(l.emailEnc ?? undefined, decrypt) ?? (l.primary ? primaryAddress : null)
    if (stored) return { text: stored, full: true, method: l.method, primary: l.primary }
    const masked = l.emailDomain ? `***@${l.emailDomain}` : 'Address hidden'
    return { text: masked, full: false, method: l.method, primary: l.primary }
  })
}

/** Decrypts the stored primary address, or returns null when none is stored or it cannot be read. */
export function readPrimaryAddress(enc: string | undefined, decrypt: (e: string) => string = (e) => decryptJson<string>(e)): string | null {
  if (!enc) return null
  try {
    return decrypt(enc)
  } catch {
    return null
  }
}
