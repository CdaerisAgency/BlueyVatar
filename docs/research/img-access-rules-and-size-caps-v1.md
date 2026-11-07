# /img access rules and size caps (v1)

Checked: November 6, 2026. Scope: issues #72 (Keyed only and Domain allowlist rules versus cached image URLs) and #68 (Q12, `/img` bypasses tier size caps). Spec references are to `docs/spec/blueyvatar-product-spec-v6.md` (sections 7, 10.2, 11.1, 13 and 14.1). Code references are to `origin/main` at commit `013b5b5`. I read the code and the existing tests. I did not run the service.

## Decisions needed

1. **#68 size caps:** choose how `/img` enforces tier caps. Recommendation: HMAC-sign the `/img` path at the redirect route, and restrict `/img` to the existing size ladder with a fixed quality set. Signing is the only option here that enforces a cap. The ladder bounds cost and makes cache purges complete. See Issue #68.
2. **#72 restricted avatars:** choose whether restricted users (Keyed only or a Domain allowlist) are served through the CDN. Recommendation: the rules cannot cover a publicly cached `/img` URL on the Free plan. Serve restricted users' images with `Cache-Control: private` behind a short-lived signed token, keep public users on the CDN, purge on every visibility change, and state the PDS limit in the settings UI. See Issue #72.
3. **Secret management:** both fixes need an HMAC secret on delivery (and on the indexer if it purges by exact URL). Owner to approve storing it in Infisical and a rotation procedure.
4. **Cloudflare plan:** the cleanest edge enforcement (timed HMAC validation) needs a paid Cloudflare plan. Owner to say whether a plan upgrade is acceptable instead of origin enforcement.

---

## What the code does today

| Route | File and lines | Key check | Visibility rules | Size cap | Cache-Control |
| --- | --- | --- | --- | --- | --- |
| `GET /avatar/:hash`, `GET /u/:id` | `apps/delivery/src/app.ts:172-186`, `serveAvatar` at `:126-167` | `entitle()` at `:127` (header key or `token` param, publishable key domain list in `apps/delivery/src/entitlement.ts:50-55`) | `visibilityAllows()` at `:116-124`, called at `:145` | Clamped to the tier at `packages/core/src/params.ts:69-72`; tiers in `packages/core/src/tiers.ts:24-49` | `private, max-age=<ttl>` (`app.ts:107`, `:162`) on a 302 whose `Location` is `/img/{did}/{cid}/{size}[-q].{ext}` (`packages/core/src/resolve.ts:33-36`) |
| `GET /img/:did/:cid/:file` | `app.ts:297-326` | None. `entitle()` is never called | None. Only `isRepoActive` and `isBlocked` (`:306`) | Only `1..2048` (`:305`) | `public, max-age=31536000, immutable` (`:323`, `resolve.ts:38`) |
| `GET /default/:style/:file` | `app.ts:328-342` | None | None | `Math.min(size, 2048)` (`:334`) | `public, max-age=86400` (`:340`) |

Facts that matter for both issues:

1. **`/img` has no credential of any kind.** It does not read `x-api-key`, `token`, `Origin` or `Referer`. The rate limiter is also skipped, so the 100 per day anonymous limit (`entitlement.ts:35-42`) never applies to `/img`.
2. **`/img` serves any blob of the DID, not only avatars.** The handler checks that the repo is active and the CID is not in `blocked_images`, then calls `resolver.getBlob(identity, cid)` (`app.ts:306-314`). `getBlob` fetches `com.atproto.sync.getBlob` for any CID the PDS has (`apps/delivery/src/resolver.ts:76-85`). It never checks that the CID is one of `candidates()` (`resolver.ts:87+`), so the rating filter (`r` parameter, `pickCandidate`) and the visibility rules are both skipped. Anyone can resize any public blob in any repo through this service's domain.
3. **Size, format and quality are all unconstrained on `/img`.** The file pattern is `^(\d{1,4})(?:-q(\d{1,3}))?\.(png|jpeg|webp)$` (`app.ts:72`). Size runs 1 to 2048, quality 1 to 100 (`:305`), and the format list includes JPEG and WebP although the Free tier is PNG only (`tiers.ts:26`). The existing test `serves each variant path as its own object` (`apps/delivery/src/app.test.ts:189-196`) fetches `/img/.../128-q60.webp` with no key and gets a 200.
4. **The URL is constructible without the redirect.** The DID is public, and the CID of a profile blob is public in the repo. The atproto blob spec says that once a record references a blob "the server makes the blob publicly accessible" and that blobs are content addressed by CID (<https://atproto.com/specs/blob>, checked November 6, 2026).
5. **`/img` ignores the query string, but Cloudflare does not.** Hono matches on the path only, so `/img/.../80.png?x=1` is served by the same handler. Cloudflare's default cache key "includes: Full URL: scheme, host, and URI with query string" (<https://developers.cloudflare.com/cache/how-to/cache-keys/>, checked November 6, 2026), so each new query string is a cache miss and a new resize.
6. **Visibility changes do not purge.** `setRules` only writes the row (`apps/web/lib/dashboard-store.ts:210-217`), and a search of `apps/web` finds no purge call. The indexer purges only on image-record deletes and Bluesky profile changes (`apps/indexer/src/handlers.ts:36-39`, `:63-66`). The purge covers the size ladder at default quality only, and the code comment says off-ladder and `-q` URLs stay cached (`apps/indexer/src/cloudflare.ts:12-16`).

---

## Issue #72: Can Keyed only and Domain allowlist rules cover cached image URLs?

### Question

Can the Keyed only and Domain allowlist rules in spec section 10.2 apply to image URLs that Cloudflare caches?

### Recommendation

**No, not on the Free plan with a publicly cached `/img`.** A cache hit never reaches the service, so the service cannot check a key or an Origin on a hit, and the Free plan has no edge feature that can. For restricted users, take the images out of the public cache: have the redirect route mint a short-lived signed token, serve those `/img` responses as `private` so Cloudflare never stores them, and verify the token at the origin. Keep public users on the CDN. Purge on every visibility change. Tell users plainly that this protects the service's copy only, because the same bytes stay public on their PDS.

### Evidence

**The CDN skips the origin on a hit.** Cloudflare caches a response unless the origin marks it `private`, `no-store`, `no-cache` or `max-age=0`, or sets a cookie (<https://developers.cloudflare.com/cache/concepts/default-cache-behavior/>, checked November 6, 2026). The service marks `/img` as `public, max-age=31536000, immutable` (`app.ts:323`). RFC 9111 says `private` means "a shared cache MUST NOT store the response" (section 5.2.2.7, <https://www.rfc-editor.org/rfc/rfc9111.html>, checked November 6, 2026). Cloudflare's page on Cache-Control says a `private` response "must not be stored by a shared cache like Cloudflare" (<https://developers.cloudflare.com/cache/concepts/cache-control/>, checked November 6, 2026). `immutable` "has no effect on public caches like Cloudflare, but does change browser behavior" (same page).

**The Free plan cannot vary the cache by credential.** Custom cache key options for query string, header, cookie, host and user features are listed for Enterprise only. Ignore query string and cache-deception armor are on all plans (<https://developers.cloudflare.com/cache/how-to/cache-keys/>, checked November 6, 2026). By default Cloudflare ignores `Vary` in caching decisions (cache-control page above). So a cached `/img` copy is served to anyone who requests the same URL.

**The Free plan cannot check a signed token at the edge.**

- The WAF function `is_timed_hmac_valid_v0()` "requires a Cloudflare Pro, Business, or Enterprise plan" (<https://developers.cloudflare.com/waf/custom-rules/use-cases/configure-token-authentication/>, checked November 6, 2026). Its token is `?verify=<timestamp>-<base64 MAC>`, HMAC-SHA256 over path plus timestamp, and `verify` must be the last query parameter.
- Snippets: the availability table lists Free as "No", 0 snippets (<https://developers.cloudflare.com/rules/snippets/>, checked November 6, 2026).
- Workers on Free: 100,000 requests per day, 10 ms CPU per request (<https://developers.cloudflare.com/workers/platform/limits/>, checked November 6, 2026). A Worker route in front of `/img` would count avatar traffic against that cap. The pricing page says "Only requests that hit a Worker will count against your limits" and that cache hits behind the Worker's cache are billed like invocations (<https://developers.cloudflare.com/workers/platform/pricing/>, checked November 6, 2026). Whether a cache hit on a Worker route counts toward the Free daily allowance is **unconfirmed**. The Cache API stores entries in one data center only: "the contents of the cache do not replicate outside of the originating data center" (<https://developers.cloudflare.com/workers/runtime-apis/cache/>, checked November 6, 2026).
- WAF custom rules: 5 on Free (<https://developers.cloudflare.com/waf/custom-rules/>, checked November 6, 2026). Rules are global, so they cannot hold each user's own allowlist.

**Rule order.** The phases list puts custom rules (`http_request_firewall_custom`) and rate limiting (`http_ratelimit`) before Cache Rules (`http_request_cache_settings`) (<https://developers.cloudflare.com/ruleset-engine/reference/phases-list/>, checked November 6, 2026). Whether a WAF block also applies to a request that would have been a cache hit is **unconfirmed**; that page and the WAF pages I read do not say. The rate limiting parameters page implies cached requests are seen by that engine, because it describes an option to exclude cached assets (<https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/>, checked November 6, 2026).

**Origin and Referer are weak signals.**

- `Origin` is not sent on image loads. MDN: "if a cross-origin GET or HEAD request is made in no-cors mode, the Origin header will not be added" (<https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin>, checked November 6, 2026). `<img>` uses no-cors mode, so a Domain allowlist on an image URL can rely on `Referer` only.
- `Referer` depends on the page's policy. The default is `strict-origin-when-cross-origin`, and `no-referrer` omits the header (<https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy>, checked November 6, 2026). A legitimate site that sets `no-referrer` is refused by an allowlist check, and the existing redirect check at `app.ts:57-67` and `:119-122` already fails closed in that case. MDN says the policy "defines the data that can be included" (<https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referer>, checked November 6, 2026).
- Browsers set these headers. Other clients can send any value. MDN lists both as forbidden request headers, which stops page scripts and says nothing about curl or a server. That second point is my inference.
- Cloudflare Hotlink Protection checks the referer, allows blank referers, and covers `gif`, `ico`, `jpg`, `jpeg` and `png` only, so WebP is outside it. The page does not state plan availability, so Free availability is **unconfirmed** (<https://developers.cloudflare.com/waf/tools/scrape-shield/hotlink-protection/>, checked November 6, 2026). It is also zone-wide and not per user.

**The bytes are public anyway.** The spec already says the avatar blob "stays readable from the user's PDS regardless of these rules" (spec section 10.2). The atproto blog confirms "by design, all data stored on the protocol today is public" and that spaces give access control without encryption (<https://atproto.com/blog/atproto-spaces-alpha>, checked November 6, 2026). Real access control needs a service-stored avatar (spec 10.2, option 1) or spaces.

### Leak scenarios

1. **Constructed URL.** An attacker reads the DID and CID from the public repo and requests `/img/{did}/{cid}/512.png`. The redirect route, with its Keyed only and allowlist checks, is never touched. Evidence: facts 1 and 4 above.
2. **Shared URL.** A permitted site, or a person with a key, copies the `Location` value. The URL carries no key and never expires, and the CDN keeps it for up to a year (`app.ts:323`).
3. **Stale cache after tightening.** A user switches from Public to Keyed only. Copies cached earlier stay at the edge for up to a year, because `setRules` does not purge (fact 6) and off-ladder URLs are never in the purge set.
4. **Referer spoofing.** `curl -H 'Referer: https://allowed.example/'` passes any Referer-based allowlist. The existing redirect-route check has the same weakness. Browsers cannot do this to a third-party image request.
5. **Rating and block bypass.** A blob the redirect would never pick (wrong rating, or a non-avatar blob) is served by `/img` once its CID is known (fact 2).

### Options

| Option | What it covers | Cost and limits | Verdict |
| --- | --- | --- | --- |
| A. Accept the limit and say so in the settings UI | Nothing new | No build. Matches spec 10.2 wording. The issue's third checkbox | Do this in every case |
| B. Referer or Origin check on `/img` at the origin | Casual hotlinking on cache misses only | Cache hits skip it. Origin absent on image loads. Referer forgeable outside browsers and blanked by `no-referrer` | Reject |
| C. Cloudflare WAF rule or Hotlink Protection | Casual hotlinking, zone-wide | 5 global rules on Free, no per-user lists, WebP outside Hotlink Protection, Free availability of Hotlink Protection unconfirmed | Reject |
| D. Non-expiring signed path (HMAC over did, cid, size, quality, format) | A URL that cannot be constructed from public data. Fixes scenarios 1 and 5 | One cache entry per URL, so caching is unchanged. A leaked URL works forever (scenario 2). Cannot stop a shared URL | Do this, shared with Issue #68 |
| E. Short-lived signed token, verified at the origin, response `private` | Scenarios 1 to 3, for restricted DIDs only | Cloudflare does not store `private` responses, so each fetch reaches Fly and runs a resize. Browsers still cache for the token lifetime. Needs an origin-side check of the DID's rules and a rate limit | Do this for restricted DIDs |
| F. Same token verified at the edge with `is_timed_hmac_valid_v0` | Same as E, with CDN caching | Needs Pro or higher. Price **not checked**. A cached copy still has to expire when the token does, which needs `max-age` at or below the token life, so the one-year `immutable` header cannot be used | Option if the owner upgrades |
| G. Service-stored avatar for users who need real control | Real access control | Spec 10.2 option 1. Loses portability | Offer it, as the spec already says |
| H. Workers or Snippets | Edge logic | Snippets not on Free. Workers cap 100,000 requests per day on Free and run in front of every image | Reject for v1 |

Why a token with an expiry alone is not enough on a public cache: the token would be part of the cached URL. The CDN would keep serving that exact URL after the token "expires", since nothing checks it on a hit. Expiry only works if the response is not stored (option E) or the edge validates it (option F).

### Recommended design

1. Keep public DIDs exactly as today, with option D signing (see Issue #68).
2. For a DID with `keyedOnly` or a non-empty `domainAllowlist`, the redirect route (after `visibilityAllows`) adds an expiry to the signed path, for example 15 minutes, and `/img` serves it with `Cache-Control: private, max-age=<remaining lifetime>`.
3. `/img` reads `visibility(did)` only on requests that reach the origin. Public DIDs are cached, so the extra lookup is a cache-miss cost. For restricted DIDs it runs every time, so rate limit it per IP.
4. On any change to `visibility_rules`, purge `host/img/{did}/` by prefix. Free plan limits are 5 prefix purges per minute and 100 operations per request (<https://developers.cloudflare.com/cache/how-to/purge-cache/>, checked November 6, 2026). The web app does not call the purge API today, so it needs the Cloudflare token or an indexer endpoint.
5. Settings UI text, close to the current sign-up wording: "These rules control what blueyvatar serves. Your avatar file stays public on your PDS, and anyone who already saved a URL or image keeps it."

### What the owner must decide

1. Whether restricted users are worth the extra origin cost of option E, or option A alone is enough for v1. Cost per restricted view is one PDS fetch plus one resize, with nothing stored (spec section 14).
2. Token lifetime for restricted URLs. Shorter is safer and costs more origin requests.
3. Whether Referer-only allowlists on image loads are acceptable for the Domain allowlist rule, given the evidence above, or the rule should be offered for Keyed only plus a key's own domain list.
4. Whether to upgrade Cloudflare for option F.

---

## Issue #68: `/img` bypasses tier size caps

### Question

Should `/img` be protected by signed paths, a fixed size ladder, or both, and does the choice keep Cloudflare caching by file extension on the Free plan?

### Recommendation

**Both, with the ladder first.** Signing the path at the redirect route is the only choice that enforces a cap, because a ladder that includes 2048 still lets a Free caller request 2048. The ladder, with a fixed quality set and a rejection of query strings, bounds the number of variants an attacker can force from about 614,000 per CID to 45 and makes purging complete. Both keep the path ending in `.png`, `.jpeg` or `.webp`, so Cloudflare still caches by extension.

### Evidence

**The bypass exists today.** Facts 1 and 3 in "What the code does today". A Free caller who is clamped to 512 at `params.ts:69-72` can request `/img/{did}/{cid}/2048.webp` directly. The same applies to format (Free is PNG only) and quality.

**Variant count.** The pattern allows 2,048 sizes, 100 qualities and 3 formats, and PNG ignores quality in `imagePath` but the route still accepts `-qNN.png`. That is at most 2,048 x 100 x 3 = 614,400 URLs per CID. Each miss runs a sandboxed resize with a 10 second timeout and 256 MiB heap (spec section 14). Cloudflare request collapsing helps only for the same URL: "Only the first request is forwarded to the origin" (<https://developers.cloudflare.com/cache/concepts/default-cache-behavior/>, checked November 6, 2026).

**Cache busting by query string.** Fact 5. A ladder alone does not stop `?x=1`, `?x=2` and so on, because the default cache key includes the query string and the handler ignores it. The origin should answer 404 to any query string on `/img` before doing any work. Ignore query string is available on all plans as a Cache Level (<https://developers.cloudflare.com/cache/how-to/cache-keys/>, checked November 6, 2026). Whether Free Cache Rules expose it as a rule setting is **unconfirmed**, because the Cache Rules settings page says it is "also open to Pay-as-you-go customers" without naming Free (<https://developers.cloudflare.com/cache/how-to/cache-rules/settings/>, checked November 6, 2026). Origin rejection does not depend on it.

**The ladder already exists in code.** `IMAGE_SIZE_LADDER = [16, 24, 32, 48, 64, 80, 96, 128, 160, 192, 256, 320, 512, 1024, 2048]` (`packages/core/src/resolve.ts:41`) and `ladderPaths` (`:50-52`) are used by the indexer purge. The delivery route does not enforce it.

**Extension caching is kept.** Cloudflare caches by file extension, with PNG, JPEG and WEBP in the default list, and the Free plan limit is 512 MB per file (<https://developers.cloudflare.com/cache/concepts/default-cache-behavior/>, checked November 6, 2026). A signature placed in a path segment before the file name leaves the extension last. A signature in a query string would also be cached by default, and Cloudflare's token function expects `verify` as the last query parameter, but a query signature makes purge by prefix less useful and invites the query-string cache-busting problem above. Prefer a path segment.

**Edge enforcement is not available on Free.** See the Issue #72 evidence (timed HMAC on Pro and above, no Snippets on Free, Worker cap). Enforcement therefore happens at the origin on a cache miss. That is sufficient for size caps: a cache hit serves only the exact URL that was signed, so a hit cannot widen a size.

**Rate limiting is a backstop only.** Free plan rate limiting rules: 1 rule, counting by IP, 10 second period, 10 second mitigation timeout, expression fields Path and Verified Bot (<https://developers.cloudflare.com/waf/rate-limiting-rules/>, checked November 6, 2026). On plans where the option is unavailable, cached assets are counted too (<https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/>, checked November 6, 2026). Whether that applies to Free is **unconfirmed**, so a rule on `/img` could throttle ordinary CDN traffic from a shared IP. Set it high if used.

### Attack scenarios

1. **Cap bypass.** A Free key or anonymous caller builds `/img/{did}/{cid}/2048.png` and receives a 2048 pixel image with no key and no quota use. Spec section 11.1 sells 1024 and 2048 as paid.
2. **Format and quality bypass.** The same caller requests `.webp` or `-q100.jpeg` where the tier allows PNG only.
3. **Cost amplification.** An attacker loops sizes 1 to 2048, qualities 1 to 100 and formats over a popular DID, or appends a random query string. Every request is a miss and a resize. The usage meter records the cost against the DID's service counters (`app.ts:319-320`), so the victim pays. The `/default` route has the same shape, with an unbounded `seed` query parameter in the cache key (`app.ts:335`).
4. **Open resizer.** Any blob CID in any repo can be requested (fact 2), including blobs the redirect would never serve.
5. **Incomplete purge.** Off-ladder and `-q` copies survive a takedown purge (fact 6), which a ladder removes by construction.

### Options

| Option | Enforces a tier cap | Variant bound | Caching on Free | Cost and trade-offs |
| --- | --- | --- | --- | --- |
| 1. Ladder only | No. The ladder includes 2048 | Yes: 15 sizes x 3 formats x fixed quality | Unchanged | Small change in `app.ts:297-326`. Complete purges. A caller can still fetch any ladder size, including 2048 |
| 2. Signed path only | Yes, for size, format and quality | No, a signed URL exists per issued variant, but an attacker cannot mint new ones | Unchanged, one entry per URL | HMAC secret to manage. Old unsigned URLs break at cutover. Leaked signed URLs work indefinitely, which is acceptable for a cap |
| 3. Both (recommended) | Yes | Yes | Unchanged | Option 2 cost plus a ladder check. Redirect snaps `s` up to the next ladder size that is at most the tier cap |
| 4. Per-tier path prefix, such as `/img/free/...` | Only if the origin trusts the prefix | Partly | Unchanged | Anyone can use the prefix they like. Not an enforcement |
| 5. Referer or Origin check | No | No | Hits skip it | Same weaknesses as Issue #72 option B |
| 6. Cloudflare timed HMAC at the edge | Yes | No | Cache key per URL | Needs Pro or higher. Price **not checked** |
| 7. Workers or Snippets | Yes | Yes | Hits run Worker code | Snippets not on Free. Workers cap 100,000 per day on Free |
| 8. Rate limit `/img` | No | Slows an attack | Unchanged | One Free rule, IP only. Backstop |

### Recommended design

1. **Ladder.** `/img` accepts only sizes in `IMAGE_SIZE_LADDER`, formats `png`, `jpeg`, `webp`, and a fixed set of qualities. Anything else is a 404 before any lookup. Reject any query string on `/img`.
2. **Snap at the redirect.** `serveAvatar` clamps to the tier cap (`params.ts:69-72`), then snaps up to the next ladder size that does not exceed the cap. Because 512 and 1024 are ladder members, the existing caps stay exact.
3. **Sign.** The redirect builds `/img/{did}/{cid}/{sig}/{size}[-q].{ext}`, where `sig` is a truncated HMAC-SHA256 over `did`, `cid`, size, quality and format with a key id for rotation. The signature does not cover the tier or the license, so every caller who gets the same variant gets the same URL and the cache keeps one entry. `/img` recomputes it and answers 404 on mismatch, before any PDS fetch. Changes: `imagePath` in `packages/core/src/resolve.ts:33-36`, the handler in `app.ts:297-326`, and the purge builder `ladderPaths` (`resolve.ts:50-52`), which needs the secret or can use prefix purge `host/img/{did}/{cid}/`.
4. **Bind the CID to a candidate.** Issue signatures only for CIDs that `pickCandidate` returned. This closes the open-resizer and rating gaps in fact 2.
5. **Transition.** Unsigned URLs already cached in browsers (up to the 28 day `ttl`) and on third-party pages stop working at cutover. Either accept that, or serve unsigned requests for a fixed window at 512 PNG only. The owner decides.
6. **Tests** (`apps/delivery/src/app.test.ts`): unsigned and mis-signed paths return 404, a Free request cannot obtain a signed 1024 or 2048 URL, an off-ladder size returns 404, a query string returns 404, and the redirect `Location` ends in the expected extension.
7. **Backstop.** One Cloudflare rate limiting rule on `/img*` with a generous threshold. Do not rely on it.

### What the owner must decide

1. Signing, ladder, or both. This document recommends both.
2. The quality set. Suggested: 85 only for PNG, and 60, 85 for JPEG and WebP. Callers lose arbitrary `q`.
3. Whether to break unsigned URLs at cutover or keep a transition window.
4. Whether `/default` gets the same ladder and a seed length limit.
5. Whether a non-expiring signature is acceptable for caps. A leaked 2048 URL gives one image at one size, and the image is public on the PDS anyway.

---

## Items marked unconfirmed

1. Whether Workers cache hits on a route count toward the Free 100,000 per day allowance.
2. Whether a WAF custom rule applies to requests that would be cache hits.
3. Whether Hotlink Protection is available on the Free plan.
4. Whether Free Cache Rules offer Ignore query string as a rule setting.
5. Whether the rate limiting "apply to cached assets" option is unavailable on Free, and so counts cache hits.
6. The price of the Cloudflare plan that includes `is_timed_hmac_valid_v0`.
7. Runtime behavior of the service. The findings come from reading the code and tests. No request was sent to a running instance.

## Sources

All checked November 6, 2026.

- Cloudflare, default cache behavior: <https://developers.cloudflare.com/cache/concepts/default-cache-behavior/>
- Cloudflare, cache keys: <https://developers.cloudflare.com/cache/how-to/cache-keys/>
- Cloudflare, Cache-Control directives: <https://developers.cloudflare.com/cache/concepts/cache-control/>
- Cloudflare, Cache Rules settings: <https://developers.cloudflare.com/cache/how-to/cache-rules/settings/>
- Cloudflare, purge cache: <https://developers.cloudflare.com/cache/how-to/purge-cache/>
- Cloudflare, rate limiting rules: <https://developers.cloudflare.com/waf/rate-limiting-rules/> and <https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/>
- Cloudflare, custom rules: <https://developers.cloudflare.com/waf/custom-rules/>
- Cloudflare, token authentication: <https://developers.cloudflare.com/waf/custom-rules/use-cases/configure-token-authentication/>
- Cloudflare, phases list: <https://developers.cloudflare.com/ruleset-engine/reference/phases-list/>
- Cloudflare, rules language operators: <https://developers.cloudflare.com/ruleset-engine/rules-language/operators/>
- Cloudflare, Snippets: <https://developers.cloudflare.com/rules/snippets/>
- Cloudflare, Workers limits, pricing and Cache API: <https://developers.cloudflare.com/workers/platform/limits/>, <https://developers.cloudflare.com/workers/platform/pricing/>, <https://developers.cloudflare.com/workers/runtime-apis/cache/>
- Cloudflare, Hotlink Protection: <https://developers.cloudflare.com/waf/tools/scrape-shield/hotlink-protection/>
- MDN, Referer, Origin, Referrer-Policy, Cache-Control: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referer>, <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin>, <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy>, <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control>
- RFC 9111, HTTP Caching: <https://www.rfc-editor.org/rfc/rfc9111.html>
- RFC 8246, immutable: <https://www.rfc-editor.org/rfc/rfc8246>
- atproto, blobs: <https://atproto.com/specs/blob>
- atproto, spaces alpha: <https://atproto.com/blog/atproto-spaces-alpha>
