/** Where sign-in sends the user afterward. Only same-site paths under /account qualify, so a crafted link cannot bounce people elsewhere. */
export const NEXT_COOKIE = 'bv_next'
export const DEFAULT_NEXT = '/account'

export function safeNext(raw: string | null | undefined): string {
  if (!raw || raw.length > 300) return DEFAULT_NEXT
  if (!/^\/account(\/[A-Za-z0-9._~\-/]*)?(\?[A-Za-z0-9._~\-=&%]*)?$/.test(raw)) return DEFAULT_NEXT
  if (raw.includes('//') || raw.includes('..')) return DEFAULT_NEXT
  return raw
}

export const loginPath = (next: string): string => {
  const n = safeNext(next)
  return n === DEFAULT_NEXT ? '/login' : `/login?next=${encodeURIComponent(n)}`
}
