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
  emailHash: string
  /** The full address (primary only, for the signed-in owner) or a masked form such as `***@cdaeris.com`. */
  text: string
  /** True when `text` is the full address. */
  full: boolean
  method: string
  primary: boolean
}

/**
 * What the owner sees for each linked email. The service keeps the address itself, encrypted, only for the primary email,
 * so that one is shown in full. Other links keep a hash and a domain, so they are shown masked (the first letter of the
 * address is not stored, so the whole local part is hidden) with the hash left for a "Details" disclosure.
 */
export function describeLinkedEmails(links: LinkRow[], primaryAddress: string | null): LinkedEmailView[] {
  return links.map((l) => {
    if (l.primary && primaryAddress) return { emailHash: l.emailHash, text: primaryAddress, full: true, method: l.method, primary: true }
    const text = l.emailDomain ? `***@${l.emailDomain}` : 'Address hidden'
    return { emailHash: l.emailHash, text, full: false, method: l.method, primary: l.primary }
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
