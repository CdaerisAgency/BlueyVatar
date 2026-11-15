/** Drops trailing slashes, so a base URL can be joined with a path that starts with one. */
export const trimSlash = (s: string): string => s.replace(/\/+$/, '')
