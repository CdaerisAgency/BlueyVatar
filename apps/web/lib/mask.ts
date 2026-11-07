/** Masked form shown once, at link time: j***@e***.com. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.trim().split('@')
  const dot = domain.indexOf('.')
  const host = dot === -1 ? domain : domain.slice(0, dot)
  const tld = dot === -1 ? '' : domain.slice(dot)
  return `${local.slice(0, 1)}***@${host.slice(0, 1)}***${tld}`
}

/** Loose shape check before we mail a code. */
export function looksLikeEmail(value: string): boolean {
  const v = value.trim()
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

/**
 * The domain part of an email address, lowercased, or null when there is none. Only this part is stored on the link
 * row (issue #128); the full address is never kept in the clear.
 */
export function emailDomain(email: string): string | null {
  const v = email.trim()
  const at = v.lastIndexOf('@')
  const d = at === -1 ? '' : v.slice(at + 1).toLowerCase().replace(/\.$/, '')
  return d !== '' && d.length <= 253 && !/[\s@]/.test(d) ? d : null
}
