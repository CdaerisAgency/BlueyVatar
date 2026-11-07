/**
 * Admin access settings. Both must be set or the admin page is off and answers 404.
 * ADMIN_DIDS: comma or space separated DIDs allowed to sign in. ADMIN_TOTP_SECRET: base32 secret for the second factor.
 */
export function adminDids(env: Record<string, string | undefined> = process.env): string[] {
  return (env.ADMIN_DIDS ?? '').split(/[\s,]+/).filter((d) => /^did:(plc|web):\S+$/.test(d))
}

export function totpSecret(env: Record<string, string | undefined> = process.env): string | null {
  return env.ADMIN_TOTP_SECRET?.trim() || null
}

export function adminEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return adminDids(env).length > 0 && totpSecret(env) !== null
}

export function isAdminDid(did: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  return !!did && adminDids(env).includes(did)
}

/** Admin sessions end 30 minutes after the second factor, whatever the activity. */
export const ADMIN_SESSION_TTL_MS = 30 * 60 * 1000
export const ADMIN_COOKIE = 'bv_admin'
