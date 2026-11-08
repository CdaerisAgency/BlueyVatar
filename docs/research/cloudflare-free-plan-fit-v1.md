# Cloudflare Free plan fit for a paid service (v1)

Checked: November 6, 2026. Scope: issue #70, spec sections 13 (Cloudflare and image items, item 3) and 14.1 of `docs/spec/blueyvatar-product-spec-v12.md`, and the Cloudflare settings that `docs/deploy.md` relies on. This is a summary of what Cloudflare's published terms and docs say, not legal advice. Items marked **unconfirmed** have no published answer in the pages I opened.

## Question

Is the Cloudflare Free plan acceptable once paying customers depend on BlueyVatar, and if not, what should trigger a change?

## Recommendation

**Launch and run the beta on Free. Move to Pro when the first paid plan goes live, and get Cloudflare's written answer on the image-serving clause before then.**

1. The limits the deploy relies on fit Free with room to spare (see the table). Nothing in the deploy needs a paid plan.
2. The biggest exposure is a CDN clause that covers Free, Pro, and Business equally. It lets Cloudflare limit CDN access for a site that serves a disproportionate share of pictures or other large files without Cloudflare's paid developer or image products. An upgrade to Pro does not remove it. Whether small avatars fall under it is **unconfirmed**, and only Cloudflare can say.
3. Pro buys ticket support, more rule headroom, and a faster purge rate. It does not buy an uptime SLA. Cloudflare lists a 100% uptime SLA with service credits starting at Business.
4. Cloudflare's own Free plan description reads "for personal or hobby projects that aren't business-critical". Paying customers make the service business-critical for them, which is the reason to pay for ticket support.

## Evidence

### What the terms say

| Topic | What is published | Source |
| --- | --- | --- |
| Serving images on Free | The CDN section of the service-specific terms (last updated September 28, 2026) says customers other than Enterprise must use certain paid services to serve video and other large files, with the Developer Platform, Images, and Stream as examples. It says Cloudflare may disable or limit CDN access if a site serves video or a "disproportionate percentage of pictures, audio files, or other large files" without them, and that Cloudflare will use reasonable efforts to notify the customer. The section heads "Free, Pro, or Business", so it applies to all three | <https://www.cloudflare.com/service-specific-terms-application-services/> |
| Size or share threshold for that clause | No published answer found. The text gives no file size, bandwidth, or percentage | same page |
| Commercial use | The Self-Serve Subscription Agreement has no clause that addresses commercial use directly. Section 2.1 grants a "limited, revocable, non-exclusive, non-transferable" right to use the services. Section 2.2.1(a) prohibits renting, leasing, loaning, exporting, or selling access to third parties. Whether selling an avatar API counts as selling access to Cloudflare's services is **unconfirmed**, and the owner should ask Cloudflare | <https://www.cloudflare.com/terms/> |
| Free services | Section 2.6 says Free services end at the earliest of a trial end, a paid term start, or termination by Cloudflare "in our sole discretion", and that Cloudflare has no liability for harm arising from Free services | <https://www.cloudflare.com/terms/> |
| SLA and warranty | The agreement contains no SLA, and section 11 disclaims warranties on quality, reliability, and availability. The Self-Serve page says it was last updated September 12, 2025, so confirm that it is still the current version | <https://www.cloudflare.com/terms/> |
| Plan descriptions | Free: "For personal or hobby projects that aren't business-critical." Pro: "For professional websites that aren't business-critical." Business: "For small businesses operating online." Contract: "For mission-critical applications that are core to your business." The spec and issue cite a different page for the "personal projects" wording. That page (<https://www.cloudflare.com/lp/pg-all-plans-multi-sku-simple/>) returned HTTP 403 to my fetch on November 6, 2026, so I could not re-verify the wording there | <https://www.cloudflare.com/plans/network-cdn.md> |
| Prices | Free $0. Pro $25 per month billed monthly, $20 billed annually. Business $250 monthly, $200 annually. Contract is custom | same page |
| Support and SLA | Free: community forums and docs. Pro: tickets and community. Business: tickets, chat, and community. No uptime SLA is listed for Free or Pro. Business lists 100% with 1x credits | same page |
| Bandwidth cap on Free | No published answer found in the pages opened. None of the terms or docs pages named a bandwidth or request cap | pages above |

### Limits the deploy relies on

Each row compares the Free value with Pro, from the pages named. "Use" is how `docs/deploy.md` and the spec use the feature.

| Feature | Free | Pro | Use in BlueyVatar | Source |
| --- | --- | --- | --- | --- |
| Cache Rules | 10 | 25 | None. Default cache rules cache `/img/*` by extension. The deploy says not to add Cache Everything | <https://developers.cloudflare.com/cache/how-to/cache-rules/> (updated August 14, 2026) |
| Transform Rules | 10 active, no regex | 25 active, no regex | One request header rule for `x-origin-auth` | <https://developers.cloudflare.com/rules/transform/> (updated August 14, 2026) |
| Cached by default | PNG, JPEG, WEBP, and AVIF by extension. Not HTML or JSON. 512 MB per file on Free, Pro, and Business | same | `/img/{did}/{cid}/{size}.{ext}` | <https://developers.cloudflare.com/cache/concepts/default-cache-behavior/> (updated September 14, 2026) |
| `private` responses | Not cached | same | Redirect routes send `private`, so they pass to the origin | same page |
| URL purge | 800 URLs per second, 100 per request | 1,500 per second, 100 per request | Indexer purges on avatar change | <https://developers.cloudflare.com/cache/how-to/purge-cache/> (updated September 29, 2026) |
| Prefix, hostname, tag, and purge everything | 5 requests per minute, bucket of 25 | 5 requests per second, bucket of 25 | Avoid these for per-avatar purges on Free | same page |
| Tiered Cache (Smart Tiered Cache Topology) | Available | Available | Not configured yet. Cuts the number of data centers that reach the origin on a miss | <https://developers.cloudflare.com/cache/how-to/tiered-cache/> (updated November 3, 2026) |
| Cache retention | Set by popularity and cache size, not configurable, no guaranteed minimum | same | Rarely requested avatars can be evicted and resized again | <https://developers.cloudflare.com/cache/concepts/retention-vs-freshness/> (updated May 6, 2026) |
| Origin Cache Control | On, and only Enterprise can turn it off | same | Cache-Control from delivery is honored | <https://developers.cloudflare.com/cache/concepts/cache-control/> (updated June 30, 2026) |

Reading: the deploy uses 1 of 10 Transform Rules and 0 of 10 Cache Rules. Per-URL purges stay well inside 800 URLs per second at launch volumes (my arithmetic, since traffic is unknown). The purge row that matters is prefix purge at 5 requests per minute on Free, which only bites if the indexer switches to prefix purges.

### Cloudflare for SaaS (custom profile domains, Plus plan)

- Plans page (updated August 14, 2026): 100 custom hostnames are included on Free, Pro, and Business, at $0.10 for each additional hostname, with a maximum of 50,000. The page states no zone-plan requirement for custom hostnames. Enterprise adds custom certificates, wildcard custom hostnames, and apex proxying as a paid add-on. Source: <https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/>.
- Terms: the "SSL for SaaS" section of the service-specific terms limits use to securing end customers' subdomains within your integrated SaaS application. It says you may not give customers direct access to the Cloudflare dashboard or APIs, and it prohibits acting as a managed service provider or reseller of Cloudflare services. It states no plan requirement. Source: <https://www.cloudflare.com/service-specific-terms-application-services/>.
- This matches `docs/research/decisions-phase2-v1.md` Decision 2. Whether profile domains at `/p/{handle}` fit "integrated SaaS application" is **unconfirmed**, and it is a question for Cloudflare.

## Risks

1. **CDN clause.** An image-heavy site on Free, Pro, or Business could be limited, with only "reasonable efforts" at notice. No threshold is published. Failure mode: avatars stop caching or serving, and the origin takes the full load.
2. **No SLA below Business.** Free and Pro have none, and the agreement disclaims availability. Customers cannot be promised uptime that rests on Cloudflare.
3. **Free can end at Cloudflare's discretion** (section 2.6), with no liability for the harm.
4. **Support.** Free has community support only, which is thin if the CDN misbehaves while customers wait.
5. **Cache retention is unpublished.** This affects cost, since evicted images are resized again, and does not change which plan is needed.
6. **Terms and prices change.** The pages carry update dates from May to November 2026. Recheck them before launch.

## What the owner must decide

1. **Ask Cloudflare in writing** (support, or sales for a Pro account) whether an avatar service delivering resized images through the CDN fits the CDN clause, and whether the agreement's restriction on selling access applies to an API that fronts it. Record the reply in this folder.
2. **Upgrade trigger.** Recommended: move to Pro when the first paid plan is billed ($20 to $25 per month). Alternatives: wait for a Cloudflare notice, or a revenue or traffic number you set. Choose one.
3. **Business trigger.** Move to Business ($200 to $250 per month) only if a customer contract needs an uptime SLA, or Cloudflare asks. Decide whether you will offer any SLA at all.
4. **Fallback plan.** The terms name Images and the Developer Platform as the paid route for image delivery. Decide whether to keep that route as the planned exit if Cloudflare limits the Free CDN. The spec parks R2 and Images today (section 14.1), and R2 prices are in `docs/research/originals-bucket-v1.md`.
5. **Custom domains.** Decide whether to ask Cloudflare about the SaaS clause before selling the Plus profile-domain feature.
