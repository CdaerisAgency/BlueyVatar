import { tagAttributes } from './relme.js'
import type { Fetcher } from './safe-fetch.js'
import { parseSafeHttpsUrl } from './safe-url.js'

/**
 * Free-tier attribution (spec sections 10.3, 11.1, and 12). The developer publishes a followable link to
 * blueyvatar.com on their production site. These helpers detect that link. No tracking is involved: the
 * checker only reads the declared page.
 */
export type AttributionResult = 'found' | 'nofollow' | 'missing' | 'unreachable'

/** Results that count as a failed check. `unreachable` is inconclusive and never triggers a notice. */
export const ATTRIBUTION_FAILED: readonly AttributionResult[] = ['nofollow', 'missing']

const HOSTS = new Set(['blueyvatar.com', 'www.blueyvatar.com'])
/** A rel token that tells search engines not to pass credit, so the link is not "followable". */
const UNFOLLOWED = new Set(['nofollow', 'ugc', 'sponsored'])

/** The attribution link, as a copy-ready HTML snippet. The href is the bare site address, with no query string. */
export const ATTRIBUTION_SNIPPET = '<a href="https://blueyvatar.com">Avatars by blueyvatar</a>'

/**
 * Looks for an a element that links to blueyvatar.com (or www.), over http or https, with a rel list that does not
 * hold nofollow, ugc, or sponsored. A link that exists only with such a rel gives `nofollow`. Anything else is `missing`.
 * `<link>` elements do not count, because they are not visible links.
 */
export function detectAttribution(html: string, base: string): 'found' | 'nofollow' | 'missing' {
  let seen = false
  for (const { tag, attrs } of tagAttributes(html)) {
    if (tag !== 'a' || !attrs.href) continue
    let u: URL
    try {
      u = new URL(attrs.href.trim(), base)
    } catch {
      continue
    }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !HOSTS.has(u.hostname.toLowerCase())) continue
    const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    if (rel.some((t) => UNFOLLOWED.has(t))) {
      seen = true
      continue
    }
    return 'found'
  }
  return seen ? 'nofollow' : 'missing'
}

/** Fetches the declared production page and reports on it. A fetch failure or non-2xx answer is `unreachable`. */
export async function checkAttribution(site: string, fetcher: Fetcher): Promise<AttributionResult> {
  if (!parseSafeHttpsUrl(site)) return 'unreachable'
  try {
    const r = await fetcher(site, { maxBytes: 2_000_000, headers: { accept: 'text/html' } })
    if (r.status < 200 || r.status >= 300) return 'unreachable'
    return detectAttribution(r.text, r.url)
  } catch {
    return 'unreachable'
  }
}

export type SiteResult = { ok: true; value: string } | { ok: false; error: string }

/** Validates the production URL a developer declares: public https, no credentials, no fragment. */
export function validateAttributionSite(input: string): SiteResult {
  const v = input.trim()
  if (!v) return { ok: false, error: 'Enter the address of your production site.' }
  if (v.length > 300) return { ok: false, error: 'That address is too long.' }
  const u = parseSafeHttpsUrl(v)
  if (!u) return { ok: false, error: 'Use a public https address with no username or port, such as https://example.com/.' }
  u.hash = ''
  return { ok: true, value: u.href }
}
