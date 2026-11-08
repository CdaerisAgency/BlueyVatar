export const HANDLE_ERROR = 'Enter a valid handle, such as username.bsky.social. It needs a dot and no @ in the middle.'

/** Trims, strips one leading @, and lowercases. Returns null when the result cannot be a handle. */
export function normalizeHandle(raw: string): string | null {
  const h = raw.trim().replace(/^@/, '').toLowerCase()
  if (!h || !h.includes('.') || h.includes('@') || /\s/.test(h)) return null
  return h
}
