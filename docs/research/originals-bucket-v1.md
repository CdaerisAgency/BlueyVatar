# Originals bucket when a PDS is slow or down (v1)

Checked: November 6, 2026. Scope: issue #71, spec sections 4, 7, 13 (Cloudflare and image items, item 4), and 14 and 14.1 of `docs/spec/blueyvatar-product-spec-v7.md`, plus the delivery code in `apps/delivery/src` (read only). Items marked **unconfirmed** have no published answer in the pages I opened.

## Question

Should blueyvatar keep original blobs in a bucket so that a slow or dead PDS does not break image delivery?

## Recommendation

**No bucket for v1. Keep the "nothing is stored" design, and add four small mitigations. Revisit with measured data.**

1. A bucket is cheap in money (about $15 per month for a million 1 MB originals at R2's published prices) and expensive in obligations. It would hold copies that the atproto blob spec says the PDS deletes with the record or account, so the service would need its own takedown and deletion path.
2. The scenarios that a bucket fixes are narrow: a cache miss on an avatar that Cloudflare has evicted or never cached, while that user's PDS is down. Popular avatars stay in Cloudflare's cache.
3. Stale-while-revalidate and stale-if-error do not help here, because the image URLs are immutable and keyed by CID (details below).
4. The four mitigations: prewarm common sizes on change, a short in-memory cache of originals, a short negative cache for upstream errors, and logging of every `getBlob` outcome so the owner can set a threshold on real numbers.

## Evidence

### How delivery behaves today

- The redirect route sends the browser to `/img/{did}/{cid}/{size}.{ext}`, and Cloudflare caches that path by extension (spec section 7, `docs/deploy.md` Cloudflare step 3).
- On a CDN miss, `apps/delivery/src/app.ts` checks the database for repo status and blocks, resolves the identity, calls `getBlob`, resizes, and answers with `Cache-Control: public, max-age=31536000, immutable`. Any failure in `getBlob` or the resize returns 502 `upstream_error`, and nothing is stored.
- `apps/delivery/src/resolver.ts` gives each PDS call a 5 second timeout with no retry. The resize has a 10 second timeout.
- Each distinct size is a separate cached object, so one avatar viewed at five sizes costs five misses and five `getBlob` calls (my reading of the route and spec section 13, item 12).

### What the protocol says about PDS availability

| Fact | Source |
| --- | --- |
| The account's PDS is the authoritative store for blobs, and app-side CDNs commonly serve resized or transcoded copies to reduce PDS load | <https://atproto.com/guides/images-and-video> |
| Originals are fetched with `com.atproto.sync.getBlob`. Apps should proxy blobs through an independent CDN or service. The spec says it is "effectively not supported to dynamically serve assets directly out of blob storage" | <https://atproto.com/specs/blob> |
| `getBlob` returns the full original, needs no authentication, and lists these errors: BlobNotFound, RepoNotFound, RepoTakendown, RepoSuspended, RepoDeactivated | <https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/sync/getBlob.json> |
| A PDS deletes a blob with its last referencing record, and deletes all of an account's blobs when the account is deleted. Deactivated, taken-down, or suspended accounts should not expose blobs publicly | <https://atproto.com/specs/blob> |
| Records may reference blobs a server does not hold, for example during imports or migrations | <https://atproto.com/specs/blob> |
| XRPC: 502, 503, and 504 are "usually temporary or permanent downtime", 429 means back off with an optional `Retry-After`, and clients should use timeouts, limited retries, and randomized exponential backoff. 501 is not retried | <https://atproto.com/specs/xrpc> |
| Account status values (takendown, suspended, deleted, deactivated) are carried by `#account` events, and a service should ignore commits for inactive accounts | <https://atproto.com/specs/sync> |
| Self-hosted PDS: the reference README targets 1 to 20 users on 1 GB RAM and 1 CPU, and states no uptime target. Rate limits are on by default, and the README gives no values | <https://github.com/bluesky-social/pds> |
| The production guide says the default setup is a single stateless Node process, blobs on local disk by default are "not recommended for production", and it gives no uptime targets | <https://atproto.com/guides/going-to-production> |
| Bluesky-hosted PDS limits: 3,000 API requests per 5 minutes per IP, with no limit published for `getBlob` or reads. The page says other providers "are likely to have different rate-limits" and publishes none for third-party PDS hosts | <https://bsky.network/docs/rate-limits> |
| Measured PDS fetch latency or failure rates across hosts | No published answer found. The issue asks for a measurement, and this document does not contain one. **Unconfirmed** |

### What Cloudflare does with the cache

| Fact | Source |
| --- | --- |
| Retention is "determined by the object's relative popularity and the size of the cache", is not configurable, and has no guaranteed minimum. Unrequested objects are eventually evicted (LRU when full) | <https://developers.cloudflare.com/cache/concepts/retention-vs-freshness/> |
| `stale-while-revalidate` lets a cache serve a stale copy for a set time after expiry while it revalidates in the background. `stale-if-error` serves stale copies only on origin 500, 502, 503, or 504, and the status codes cannot be customized. Both are ignored when Always Online is on or when `no-store`, `no-cache`, `must-revalidate`, or `s-maxage` is present | <https://developers.cloudflare.com/cache/concepts/cache-control/> |
| `immutable` is browser-facing and has no effect on Cloudflare's cache | same page |
| Cache Rules can set an Edge TTL per status code, including 404 and 5xx. The page states no plan restriction. Whether a 502 is cached by default is not stated in the pages opened | <https://developers.cloudflare.com/cache/how-to/cache-rules/settings/> |
| Tiered Cache is available on all plans, and only an upper-tier data center contacts the origin, so fewer data centers send misses to it | <https://developers.cloudflare.com/cache/how-to/tiered-cache/> |
| Cacheable file limit is 512 MB on Free. Responses marked `private` or `no-store`, or that set a cookie, are not cached | <https://developers.cloudflare.com/cache/concepts/default-cache-behavior/> |

### Scenario analysis

| Scenario | Today | Bucket changes it? |
| --- | --- | --- |
| CDN hit, PDS up or down | Served from cache. The PDS plays no part | No |
| CDN miss, PDS up and fast | One `getBlob`, one resize, then cached | No |
| CDN miss, PDS slow | Visitor waits up to the 5 second fetch plus up to the 10 second resize, then gets 502 on a timeout. Other requests for the same object wait on Cloudflare's cache lock (spec section 14.1) | Yes, if the original is already stored |
| CDN miss, PDS down | 502 `upstream_error`, nothing cached, every retry reaches the origin again. A broken image shows in the app | Yes, if the original is already stored |
| Evicted long-tail avatar, PDS down | Same as above. Retention is unpublished, so this rate is unknown | Yes |
| PDS reports takedown, suspension, deactivation, or deletion | Delivery answers 404 from the database check or the `getBlob` error | A bucket makes this worse unless the service also purges its copy |
| New avatar, PDS down | The indexer sees the change from the firehose, and the first request fails | Only if the indexer copies the original at change time |

### Why stale-while-revalidate and stale-if-error add little

The `/img` URL contains the CID, so its content never changes, and delivery sends a one-year `max-age`. An entry is never stale before Cloudflare evicts it, and eviction removes the copy that a stale directive would serve. `stale-if-error` could only matter if `max-age` were shortened, which would add revalidation traffic to the PDS for no gain. The redirect route is `private`, so Cloudflare does not hold it. So neither directive covers the failure in the table. (This is my reasoning from the pages above.)

### Cost and complexity of a bucket

R2 prices (updated October 30, 2026): Standard storage $0.015 per GB-month, Class A operations $4.50 per million, Class B operations $0.36 per million, egress free. Monthly free tier: 10 GB-month, 1 million Class A, 10 million Class B. Source: <https://developers.cloudflare.com/r2/pricing/>. The S3 API supports PutObject and GetObject with conditional headers and Range: <https://developers.cloudflare.com/r2/api/s3/api/>.

Worst-case arithmetic, using the spec's 1,000,000 byte avatar limit for Bluesky and Tangled profile records (spec section 7) as one original each (my arithmetic):

| Originals | Storage | Storage cost per month after the free 10 GB | Writes (one per original) |
| --- | --- | --- | --- |
| 100,000 | about 100 GB | about $1.35 | inside the free 1 million |
| 1,000,000 | about 1 TB | about $15 | $0 to $4.50 once, then only new avatars |

Reads happen only on misses, so Class B charges stay small. Fly volumes are the alternative named in the issue as a "Railway volume", but hosting is Fly (`docs/deploy.md`). A Fly volume costs $0.15 per GB-month, belongs to one machine in one region, does not replicate, and loses its data if the drive fails: <https://docs.fly.io/about/pricing> and <https://docs.fly.io/volumes/overview>. It would tie delivery to one machine, so R2 is the better bucket if one is built.

The cost that matters is the work and the policy:

- A write path on first fetch or at index time, with CID verification before storing (spec section 7 requirement).
- A delete path. The indexer must remove a stored original when the record is deleted, the account is deleted, or the repo is taken down, to match the protocol rules above.
- R2 credentials in Infisical, a bucket per environment, and lifecycle monitoring.
- The privacy policy and the spec's portability claim change. Section 4 says the service serves from the user's PDS and the database holds an avatar only when the user picks a service-stored image (section 10.2).
- A bucket does not remove the PDS dependency for the first fetch of a new avatar.

### Minimal option without a bucket

1. **Prewarm on change.** The spec already proposes that the indexer request common sizes through the CDN after an avatar changes (section 4). Build it. It turns the first view into a hit while the PDS is known to be up.
2. **Short in-memory cache of originals** in the delivery process, bounded by bytes, so one avatar at several sizes costs one `getBlob`. This also lowers load on small PDS hosts. It is lost on restart, which keeps it out of the storage and retention questions. Size and eviction are a design choice for the build.
3. **Short negative cache.** A Cache Rule that holds 5xx responses for the `/img/*` path for a few seconds to a minute stops a dead PDS from taking a request per visitor. The settings page states no Free plan restriction on this, but I found no confirmation either, so test it in staging (**unconfirmed**), and keep it to `/img/*` so the deploy's "no Cache Everything" rule still holds.
4. **Log every `getBlob` outcome** (host, status, latency, timeout) in delivery, and report miss failures as a share of misses. This is the measurement the issue asks for, taken from real traffic.

Also worth a follow-up issue: bounded retries with randomized backoff on 5xx and 429, as XRPC recommends, and a clear fallback when an upstream error occurs on the redirect path. Neither needs a bucket.

## Risks

1. **Unknown miss rate.** Cloudflare's retention is unpublished, so the share of requests that reach the PDS is unknown until measured.
2. **Long-tail users on weak hosts.** Small self-hosted PDS hosts have no published uptime target, so a broken image for a user on a down host is possible. This is the case a bucket would fix, at the cost above.
3. **Retry storms.** Without a negative cache, a down PDS gets one request per visitor from every size.
4. **Removal obligations.** If a bucket is added later, stale copies of deleted or taken-down blobs become the service's responsibility. Consult counsel (spec section 13, item 10).
5. **No measured data yet.** Issue #71's first checkbox stays open until delivery logs exist.

## What the owner must decide

1. **Accept "no bucket for v1"** with the four mitigations, or ask for a bucket now.
2. **Set a revisit threshold,** for example a share of misses failing because of the PDS over 30 days, or a customer contract that promises delivery independent of the PDS. Pick the number after the first month of logs.
3. **Approve the follow-up work:** indexer prewarm, the in-memory original cache, the negative cache rule, and the `getBlob` logging.
4. **Retention and takedown policy,** needed only if a bucket is ever built: how long copies live and how fast removals propagate.
5. **If a bucket is built later,** R2 or a Fly volume. This document recommends R2, since a Fly volume binds delivery to one machine.
