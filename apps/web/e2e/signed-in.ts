import { createHmac } from 'node:crypto'
import type { BrowserContext } from '@playwright/test'

// Must match SESSION_SECRET in playwright.config.ts, which the e2e web server runs with.
const SECRET = 'e2e-session-secret-not-for-production'

/** Same format as lib/session-cookie.ts (did.expiresAtMs.hmac), so the app reads the browser as signed in. */
export function signedInCookie(did = 'did:plc:e2eaccount0000000000000', now = Date.now()): string {
  const body = `${did}.${now + 3_600_000}`
  return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`
}

/** Signs the context in as a seeded account. Use in beforeEach of any test that needs an account page. */
export async function signIn(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'bv_session', value: signedInCookie(), domain: 'localhost', path: '/', httpOnly: true }])
}
