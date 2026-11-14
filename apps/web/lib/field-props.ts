// No 'use client' here: server pages call this too.
/** Props that mark a field invalid and point to its message. */
export function fieldProps(prefix: string, name: string, error: string | undefined, extra?: string) {
  return {
    id: `${prefix}-${name}`,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': [error && `${prefix}-${name}-error`, extra].filter(Boolean).join(' ') || undefined,
  }
}
