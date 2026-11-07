import { hasRelMeLink } from './relme.js'
import { SafeFetchError, type Fetcher } from './safe-fetch.js'

/** `transient` marks a failure that says nothing about the claim (server error, rate limit, network). */
export type VerifyOutcome = { ok: true } | { ok: false; reason: string; transient?: boolean }

/** Fetch the claimed page and require a rel="me" link back to the user's blueyvatar profile. */
export async function verifyRelMe(claimUri: string, expectedLink: string, f: Fetcher): Promise<VerifyOutcome> {
  try {
    const r = await f(claimUri)
    if (r.status < 200 || r.status >= 300) return { ok: false, reason: `The page answered with status ${r.status}.`, ...(r.status === 429 || r.status >= 500 ? { transient: true } : {}) }
    const type = String(r.headers['content-type'] ?? '')
    if (!/html|xml/i.test(type)) return { ok: false, reason: 'The page is not HTML.' }
    return hasRelMeLink(r.text, r.url, expectedLink)
      ? { ok: true }
      : { ok: false, reason: `No link with rel="me" to ${expectedLink} was found on the page.` }
  } catch (err) {
    return { ok: false, reason: err instanceof SafeFetchError ? err.message : 'The page could not be checked.', ...(err instanceof SafeFetchError ? {} : { transient: true }) }
  }
}
