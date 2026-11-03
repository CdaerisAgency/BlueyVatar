# blueyvatar Phase 2 decisions (v1)

Checked: November 3, 2026. Scope: spec sections 8, 11 and 14.1 of `/home/user/blueyvatar/docs/spec/blueyvatar-product-spec-v6.md`. Issues #51, #28 (verified accounts) and #38 (custom profile domains).

## Decisions needed

1. **Verified accounts (#51, #28):** choose a verification method. Recommendation: hybrid (OAuth where the platform offers a free or known-cost read, and a public proof on the account or a website everywhere else). See Decision 1.
2. **Custom profile domains (#38):** choose a hosting path. Recommendation: Cloudflare for SaaS custom hostnames for subdomains, free up to 100 hostnames. Apex domains need an Enterprise add-on. See Decision 2.
3. **Railway plan:** the owner must confirm the plan. Railway's docs and pricing page give different custom domain limits (see Decision 2).
4. **X API:** the cost of reading the signed-in user is not explicitly published. Do not ship X OAuth until the owner accepts a per-read fee.
5. **Instagram:** the Instagram API covers only Business and Creator accounts. Personal accounts have no published verification path.

---

## Decision 1: Verifying control of outside accounts (issues #51 and #28)

Two families of mechanism exist. Each option below says which one it uses.

### Option 1A: Public proof on the account or a website (Keyoxide-style)

**How it works.** The user puts a token or a link on a public surface they control. blueyvatar fetches that surface and checks for it.

- **GitHub:** post a public gist named `proof.md` containing the proof, then add the gist link to the profile. The proof string is the one Keyoxide documents: `openpgp4fpr:FINGERPRINT`, `NAME@DOMAIN.TLD`, or `aspe:DOMAIN.TLD:FINGERPRINT` ([Keyoxide GitHub proof](https://docs.keyoxide.org/service-providers/github/)). For blueyvatar, the token would be a blueyvatar-issued string.
- **Mastodon:** add an HTTPS link to the profile metadata. Mastodon checks that the linked page has an `a` or `link` tag with `rel="me"` whose `href` equals the Mastodon profile URL. If none exists, it checks whether the first link redirects to the profile URL. Verification runs when the profile is saved ([Mastodon profile docs](https://docs.joinmastodon.org/user/profile/)). This is platform-native, so the Mastodon side is the easiest to verify.
- **Personal website:** the site links to the profile, and the profile links back. The reciprocal link must carry `rel="me"`. The IndieWeb wiki describes this as the basis for distributed verification, and says only mutual `rel="me"` pairs count as the same person ([IndieWeb rel=me](https://indieweb.org/rel-me)).
- **DNS TXT (for a domain):** Keyoxide's DNS proof is a TXT record on the domain, with the value `aspe:` or `openpgp4fpr:` plus the identifier ([Keyoxide DNS proof](https://docs.keyoxide.org/service-providers/dns/)). Bluesky's handle spec uses the same idea with `_atproto` TXT records carrying `did=` ([atproto handle spec](https://atproto.com/specs/handle)).

**Cost.** No fee for these mechanisms appears in the pages I opened. GitHub's REST limit for OAuth apps is 5,000 requests per hour, and the page does not describe a charge ([GitHub rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)). That limit applies to authenticated calls, so it matters only if the service calls GitHub's API. The Keyoxide pages I opened do not describe how a proof is checked. No published answer found for the check procedure on GitHub or Mastodon from Keyoxide.

**Effort.** Low to medium. The gist and Mastodon profile checks need no platform app registration. The service must fetch and parse public pages.

**Risks.**
- No documented public-surface check exists in the pages I opened for Instagram, TikTok, Threads or X. Their profile text is reachable only through an API (Option 1B) or by scraping, and I did not review platform terms for scraping. No published answer found on whether scraping is permitted.
- Mastodon's verification runs when the profile is saved ([Mastodon profile docs](https://docs.joinmastodon.org/user/profile/)). My inference: a later removal of the link would go unnoticed unless blueyvatar re-checks it.
- IndieWeb notes that X profile links are wrapped in t.co redirects, which can complicate checks ([IndieWeb rel=me](https://indieweb.org/rel-me)).

### Option 1B: OAuth sign-in per platform

**How it works.** The user signs in with the platform. blueyvatar receives a token that proves the user controls the account at sign-in time, then reads the profile fields the scope allows.

**Cost and effort.** Per platform, in the table below. Effort is high: one app registration per platform, redirect URIs, token storage and refresh, and in some cases app review.

**Risks.** Review gates (Meta), account-type limits (Instagram), a paid read (X), and changes to platform policy. Each platform page states its own terms and can change them.

### Option 1C: Hybrid (recommended)

OAuth for the platforms with a free or low-cost, documented read, plus public-surface proof for everything else, with a website `rel="me"` link as the universal fallback.

### Per-platform table

Cost and review status are as published on the pages listed. "No published answer found" means the pages I opened did not state it.

| Platform | Method | Cost (published) | Effort | Reliability and notes |
| --- | --- | --- | --- | --- |
| GitHub | OAuth with `read:user` to read `login`, `bio`, `blog` and `html_url`. Or gist `proof.md` (1A) | `read:user` is needed for the private user response ([GitHub users](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)). Rate limit 5,000 requests per hour per OAuth app. No charge stated ([GitHub rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)) | Low (gist) to medium (OAuth) | High. The gist path is documented by Keyoxide. Check procedure not documented on the pages opened |
| Mastodon | OAuth per instance, or `rel="me"` profile link (1A) | App registration: no cost or rate limit stated ([Mastodon apps](https://docs.joinmastodon.org/methods/apps/)). Scopes: the example is `read:accounts` ([Mastodon OAuth](https://docs.joinmastodon.org/methods/oauth/)) | Medium (OAuth, one app per instance) to low (link) | High for the link method, which the Mastodon docs define ([profile docs](https://docs.joinmastodon.org/user/profile/)). Whether the account API exposes a verified-at timestamp: no published answer found on the pages opened |
| Personal website | `rel="me"` reciprocal link, or DNS TXT (1A) | No published fee | Low | Depends on the user keeping the link. IndieWeb describes mutual `rel="me"` pairs as identity consolidation ([rel=me](https://indieweb.org/rel-me)) |
| Instagram | Instagram API with Instagram Login. Covers Business and Creator accounts only ([Instagram overview](https://developers.facebook.com/docs/instagram-platform/)) | No published answer found | High (Meta app, professional account) | Personal accounts are not covered by the API. The pages opened list no profile fields and no review requirement |
| TikTok | Login Kit with `user.info.basic` (display name) and `user.info.profile` (username, bio, profile link) ([TikTok user info](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info), [Login Kit](https://developers.tiktok.com/doc/login-kit-web)) | No published answer found on the pages opened | Medium | Bio text is readable under `user.info.profile`, so a bio token check is possible. Review status: no published answer found on the pages opened. TikTok notes a scope migration plan |
| Threads | OAuth with `threads_basic`, required for all Threads endpoints ([Threads get started](https://developers.facebook.com/docs/threads/get-started/)) | No cost or fee stated on the page opened | High. Non-tester users need Meta App Review and a published app | Public-profile permission grants are valid for 90 days. Short-lived tokens last 1 hour and long-lived tokens 60 days. Profile fields: no published answer found on the page opened. IndieWeb says Threads supports two-way `rel="me"` verification ([rel=me](https://indieweb.org/rel-me)) |
| X | OAuth 2.0 with `users.read` ([X OAuth](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)) | Pay-per-use. User read is $0.010 per resource. Owned reads are $0.001. Post reads are capped at 3 million per billing cycle. `users/me` is not listed explicitly. Prices are subject to change ([X pricing](https://docs.x.com/x-api/getting-started/pricing)) | Medium | Default access token lasts 2 hours. Authorization code expires in 30 seconds ([X OAuth](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)). Per-verification cost is my inference from the User read rate. No published source states it |

Keyoxide is the closest prior art. Its proof types include GitHub, Mastodon, Bluesky, Twitter, DNS and others ([Keyoxide docs](https://docs.keyoxide.org/)). ariadne.id uses the same proof notation, as the DNS page shows `proof@ariadne.id`. The check procedure for each proof was not on the pages I opened ([Keyoxide verifying profiles](https://docs.keyoxide.org/getting-started/verifying-profiles/)).

### Recommendation (Decision 1)

**Recommendation: Option 1C, the hybrid.**

1. Use OAuth for GitHub (`read:user`) and Mastodon (per instance). Both are free on the pages I opened.
2. Use TikTok OAuth for username and bio, which allows a bio-token check. Confirm the review status before committing.
3. Use Threads OAuth only after Meta App Review. Budget for re-consent every 90 days for public profiles.
4. For Instagram personal accounts and X, use a reciprocal website `rel="me"` link: the account's profile links to the user's site, and the site links back. Mastodon's link method applies only to Mastodon. Do not use X OAuth until the owner accepts a paid read per user.
5. Use Instagram OAuth for Business and Creator accounts only, and label personal accounts as unverifiable by API.

---

## Decision 2: Custom profile domains (issue #38)

The Plus plan includes a custom profile domain (spec section 11.2). The user points a domain at their profile page at `/p/{handle}`.

### Option 2A: Cloudflare for SaaS custom hostnames (recommended)

**How it works.** blueyvatar.com stays on Cloudflare. Each customer adds a hostname (for example `me.example.com`) to that zone as a custom hostname. The customer creates a CNAME to Cloudflare's CNAME target, and traffic is routed to a default origin called the fallback origin ([Cloudflare for SaaS overview](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/)). Customer CNAMEs should point to the target, and A records are unsupported by default ([Cloudflare getting started](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/)). Validation has two steps: hostname validation and certificate validation. Methods are TXT validation, Delegated DCV, and automatic HTTP validation. Automatic HTTP validation can cause a short downtime window ([Cloudflare getting started](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/)).

**Plan and cost (checked November 3, 2026; the Cloudflare page was last updated August 14, 2026).** Cloudflare for SaaS is available on the Free plan. The Free plan includes 100 custom hostnames. Each additional hostname costs $0.10. The maximum is 50,000 hostnames on self-serve plans. Enterprise pricing is custom ([Cloudflare for SaaS plans](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/)).

Certificates: by default Cloudflare issues an ECDSA P-256 primary certificate and an RSA 2048 fallback. Custom certificates are an Enterprise option ([Cloudflare getting started](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/)).

**Apex domains.** The Cloudflare overview says apex domains need Apex Proxying, which it lists as an Enterprise add-on ([Cloudflare for SaaS overview](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/)). On Free, only subdomains are supported as published.

**Origin requirement.** The fallback origin is a blueyvatar hostname that Cloudflare proxies to Railway. Railway needs a custom domain for that hostname. Railway's docs say Cloudflare-proxied domains must use SSL mode Full, and that Full (Strict) will not work as intended ([Railway custom domains](https://docs.railway.com/networking/domains/working-with-domains)).

**Effort.** Medium to high. Automate hostname creation, validation polling, and status checks through the Cloudflare API. Test the origin's SSL mode before launch.

**Risks.**
- Railway's docs say proxied domains "may not always be able to issue a certificate" ([Railway custom domains](https://docs.railway.com/networking/domains/working-with-domains)). Certificate failure would break a customer's domain.
- The 100 included hostnames are an allowance. Each hostname beyond 100 costs $0.10 on the plans page, which does not state a billing period in the text I read. At 1,000 hostnames the extra charge would be $90 (my arithmetic: 900 times $0.10).
- Downtime during automatic HTTP validation (above).

### Option 2B: Railway custom domain per user, TLS through Railway

**How it works.** The user creates a CNAME to the Railway target shown in the dashboard, plus the TXT record Railway requests. Railway issues a Let's Encrypt certificate (ECDSA, valid 90 days, renewed at 30 days remaining) ([Railway custom domains](https://docs.railway.com/networking/domains/working-with-domains)).

**Cost and limits (checked November 3, 2026).**
- Railway pricing page: Free is $0 with 0 custom domains. Hobby is $5 per month with 2 custom domains. Pro is $20 per month with 20 custom domains. Enterprise is set per agreement ([Railway pricing](https://railway.com/pricing)).
- Railway docs: Trial is limited to 1 custom domain. Hobby is limited to 2 custom domains per service. Pro is limited to 20 domains per service by default, which can be raised on request ([Railway custom domains](https://docs.railway.com/networking/domains/working-with-domains)).
- **Discrepancy:** the pricing page counts custom domains per plan, and the docs count them per service. The owner should confirm with Railway before relying on either number.

**Effort.** Low per domain. Each customer domain is a Railway custom domain entry, which the limits above count, so this does not scale past them.

**Risks.**
- Limits: 20 domains is the default ceiling on Pro. Beyond that, an increase must be requested.
- Apex domains: Railway supports them only through CNAME flattening or dynamic ALIAS records. Some DNS providers do not support either, and Railway suggests moving nameservers to Cloudflare in that case ([Railway custom domains](https://docs.railway.com/networking/domains/working-with-domains)).
- DNS changes can take up to 72 hours to propagate ([Railway custom domains](https://docs.railway.com/networking/domains/working-with-domains)).
- Subdomains deeper than first level need Cloudflare's Advanced Certificate Manager, which Railway's docs say is required ([Railway custom domains](https://docs.railway.com/networking/domains/working-with-domains)).

### Option 2C: Domain as the atproto handle (no hosting)

**How it works.** The user's domain becomes their handle. Two documented methods prove it: a `_atproto` TXT record with `did=<DID>`, which the spec recommends for individual handles, or an HTTPS endpoint at `/.well-known/atproto-did` that returns the DID as plain text. Handles are DNS hostnames, so a custom domain is allowed ([atproto handle spec](https://atproto.com/specs/handle)). The profile stays at `blueyvatar.com/p/{handle}`.

**Cost.** No hosting cost to blueyvatar. The user pays only for their own domain. No published answer found for the cost to a user of a DNS TXT record, since DNS provider pricing is outside these sources.

**Effort.** Low. One TXT record or one static endpoint.

**Risks.**
- The user does not get a page on their own domain. This covers identity, and the profile display stays on blueyvatar.
- Valid records that name different DIDs make resolution fail ([atproto handle spec](https://atproto.com/specs/handle)).
- My inference: the `/p/{handle}` route would need to accept domain handles.

### Option 2D: Redirect from the user's domain to the profile

**How it works.** The user points their domain at a redirect that sends visitors to `blueyvatar.com/p/{handle}`. The redirect is configured by the user, in their DNS provider, registrar, or their own Cloudflare zone.

**Cost and effort.** No published answer found in the sources I opened. I did not check registrar forwarding or Cloudflare redirect products, so their prices and limits are not stated here.

**Risks.** The visitor lands on the blueyvatar URL, so the user's domain is not shown in the address bar after the redirect.

### Recommendation (Decision 2)

**Recommendation: Option 2A, Cloudflare for SaaS, for subdomains.**

1. It stays free for the first 100 custom hostnames on the Free plan, and it does not require a Railway entry per user.
2. Confirm the Railway plan before building. The fallback origin needs a Railway custom domain, and the Free plan allows 0. Hobby at $5 per month is the lowest paid tier that allows one (pricing page).
3. Limit the launch to subdomains. Apex domains need Enterprise, so offer Option 2C (domain as handle) for apex-domain owners as a free complement.
4. Test SSL Full mode on the Railway origin, and monitor certificate status for every hostname, since Railway's docs say issuance can fail behind a proxy.
5. Do not use Option 2B at scale. Its published limits (20 per service on Pro) are too low for a Plus feature.
