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
