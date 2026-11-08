# PDS original bucket: measurements and options (v1)

Checked: November 7, 2026. Scope: issue #71 and its triage comment, spec sections 4, 14, and 14.1 of `docs/spec/blueyvatar-product-spec-v13.md`, and the delivery code in `apps/delivery/src` (read only). This memo adds the measurement that `docs/research/originals-bucket-v1.md` (PR #84) listed as missing. Read that memo for the protocol and Cloudflare sources and for R2 prices. This one does not repeat them.

## Summary

- In one sample, 217 of 246 `getBlob` requests succeeded (88.2%). The 29 failures fall on 9 of 82 accounts' PDS hosts, and nearly all of those hosts failed on every try, so they were down or unreachable from this container, not flaky.
- On successful requests the median was 343 ms and the 95th percentile 983 ms. Two requests hit delivery's 5 second timeout.
- **Recommendation:** keep "no bucket for v1", add the mitigations in the last section, and set the revisit threshold from delivery logs. The cost is about 2 to 3 engineering days and no new service. A bucket would cost about $15 per month in R2 storage per million 1 MB originals, plus a delete path and policy work, per the PR #84 memo.

## Caveat on the measurements

**These numbers come from one cloud container, in one network location, going through an agent egress proxy, on one day. They are indicative only.** They are not a service-level measurement of any PDS host. Three effects limit them:

1. The proxy sat between this container and every host. For six hosts the proxy answered the CONNECT with 502, and I cannot tell whether the PDS was down or the proxy could not reach it. I report these as connection failures.
2. The sample is not traffic-weighted. It came from public actor search results, capped at 5 accounts per non-Bluesky host, so small hosts are over-represented compared with real avatar requests.
3. Each host has 1 to 5 accounts and 3 tries, so most per-host percentiles rest on 3 to 15 requests.

## Method

1. Collected actors that have an avatar from `app.bsky.actor.searchActors` on `public.api.bsky.app` with 19 query strings (about 1,800 distinct DIDs). Took the avatar CID from each avatar URL. No handles were hand-picked.
2. Shuffled and took 450 DIDs. Resolved each DID document (`https://plc.directory/{did}`, or `.well-known/did.json` for `did:web`) and read the `#atproto_pds` endpoint. All 450 resolved, onto 106 distinct PDS hosts.
3. Built the sample: 40 DIDs on Bluesky-hosted PDS hosts (`*.host.bsky.network`, grouped as one row) and up to 5 DIDs per other host. Result: 82 DIDs on 25 host groups.
4. For each DID, requested `GET {pds}/xrpc/com.atproto.sync.getBlob?did=...&cid=...` three times in sequence, with a 5 second timeout (the same value as `AtprotoResolver`) that covers connecting and reading the whole body. Python 3 `urllib`, TLS verification on, through the proxy. 246 requests in total.
5. Latency percentiles use successful (HTTP 200) requests only, with linear interpolation. Bytes were not checked against the CID here.

Scripts were run from a scratch directory and are not committed.

## Results

| Host | DIDs | Requests | OK | Errors | p50 ms | p95 ms | Median bytes |
|---|---|---|---|---|---|---|---|
| \*.host.bsky.network (Bluesky-hosted) | 40 | 120 | 119 | timeout x1 | 396 | 771 | 153,619 |
| northsky.social | 5 | 15 | 15 | 0 | 281 | 886 | 73,760 |
| eurosky.social | 5 | 15 | 14 | timeout x1 | 852 | 1,263 | 282,710 |
| blacksky.app | 5 | 15 | 15 | 0 | 240 | 361 | 350,726 |
| selfhosted.social | 5 | 15 | 15 | 0 | 198 | 320 | 23,654 |
| atproto.brid.gy | 2 | 6 | 3 | connect failure x3 | 387 | 477 | 9,662 |
| pds.sigb.us | 1 | 3 | 3 | 0 | 458 | 553 | 239,494 |
| pds.furtenbach.social | 1 | 3 | 3 | 0 | 930 | 1,030 | 169,751 |
| gruen.lol | 1 | 3 | 3 | 0 | 211 | 305 | 67,397 |
| profile.blue | 1 | 3 | 3 | 0 | 226 | 235 | 73,241 |
| mk.pds.mk.gg | 1 | 3 | 3 | 0 | 487 | 498 | 63,065 |
| hereticsasylum.com | 1 | 3 | 3 | 0 | 319 | 532 | 486,276 |
| pds.aaronsalmon.com | 1 | 3 | 3 | 0 | 290 | 310 | 179,994 |
| kape.xyz | 1 | 3 | 3 | 0 | 2,794 | 2,804 | 981,536 |
| streamplace.com | 1 | 3 | 3 | 0 | 469 | 593 | 981,239 |
| cocoon.hailey.at | 1 | 3 | 3 | 0 | 802 | 1,018 | 695,245 |
| jluther.org | 1 | 3 | 3 | 0 | 957 | 1,110 | 723,155 |
| pds.kart.sh | 1 | 3 | 3 | 0 | 229 | 265 | 400,342 |
| funkypenguin-bluesky-pds.elfhosted.com | 1 | 3 | 0 | HTTP 500 x3 | - | - | - |
| pds.viois.gay | 1 | 3 | 0 | HTTP 502 x3 | - | - | - |
| at.indexx.dev | 1 | 3 | 0 | connect failure x3 | - | - | - |
| atp.bitflips.org | 1 | 3 | 0 | connect failure x3 | - | - | - |
| bsky.daedric.world | 1 | 3 | 0 | connect failure x3 | - | - | - |
| collantes.me | 1 | 3 | 0 | connect failure x3 | - | - | - |
| social.markbennett.dev | 1 | 3 | 0 | connect failure x3 | - | - | - |
| pds.woof.monster | 1 | 3 | 0 | connect failure x3 | - | - | - |

Percentiles on rows with 1 DID are three requests, so read them as single observations.

All requests: 246 sent, 217 OK (88.2%). Failures: 21 connection failures, 3 HTTP 500, 3 HTTP 502, 2 timeouts at 5 seconds. Successful latency: p50 343 ms, p95 983 ms, max 2,805 ms.

Each try separately (successes only): try 1 p50 396 ms and p95 1,042 ms; try 2 p50 319 ms and p95 868 ms; try 3 p50 317 ms and p95 907 ms. The tries ran back to back with no cache control on the PDS side, so this only hints that a first request may be slower. I did not test it further.

**Failure grouping**

- 9 of 82 DIDs (11%) failed all 3 tries. Eight sit on single-account hosts in the table above, and the ninth is one of the two `atproto.brid.gy` accounts. Among the 42 DIDs on non-Bluesky hosts that is 9 of 42 (21%).
- Only 2 requests failed on a host that otherwise worked (one Bluesky-hosted, one on eurosky.social), both as 5 second timeouts. For the 40 Bluesky-hosted DIDs, 1 of 120 requests failed.
- Of the 6 hosts that refused the connection, curl through the proxy showed CONNECT 502 for four. For `bsky.daedric.world` curl reported a certificate it could not verify, and for `collantes.me` a TLS internal-error alert. I did not look further, and I did not disable verification.
- The slowest successful host was `kape.xyz` at about 2.8 seconds for a 981 KB original. Latency rises with blob size in this sample, and the spec's avatar limit is 1,000,000 bytes (PR #84 memo), so originals near that limit are common among the slow cases. I did not fit a model, so this is an observation.

**Other finding.** One DID document (host `pds.shatteredsky.net`) lists the PDS endpoint without a URL scheme. `AtprotoResolver.getBlob` builds the URL with `new URL('/xrpc/...', identity.pds)`, which throws on a value like that, so delivery would answer 502 for this account on every miss. I did not run delivery against it. I left this account out of the sample. Worth a validation or log line.

## How delivery handles a miss today

From `apps/delivery/src/app.ts` and `resolver.ts` (read only):

- Route `/img/:did/:cid/:sig/:file`. After signature, repo status, block, and visibility checks, it resolves the identity, calls `getBlob`, resizes, and answers `public, max-age=31536000, immutable` (`IMMUTABLE_CACHE_CONTROL`).
- `getBlob` has a 5 second `AbortSignal.timeout`, no retry, and throws on any non-2xx status. It also throws if the bytes do not match the CID.
- Any exception from `getBlob` or the resize returns HTTP 502 `upstream_error` and nothing is stored. There is no stale copy, no negative cache, and no distinction between a missing blob (404 from the PDS) and a down PDS: both become 502.
- Spec section 4: the delivery API fetches from the PDS "only when the CDN has no copy of the resized image", the database holds an avatar only for service-stored images, and the avatar stays in the user's repo if the service goes down. Section 14: resizing runs in a forked process with a 10 second timeout and "nothing is stored". Section 14.1: R2 is parked, caching is by extension, and a cache lock limits duplicate requests per data center.

## Failure modes seen or implied

| Mode | Seen in the sample | Effect on delivery today |
|---|---|---|
| Host unreachable or TLS failure | Yes, 6 hosts | 502 on every miss until the host returns |
| Host returns 5xx | Yes, 2 hosts | 502 on every miss, and each visitor retries the origin |
| Slow response beyond 5 seconds | Yes, 2 requests | 502 after 5 seconds, plus the cache lock holds other requests |
| Large blob on a slow host | Yes, `kape.xyz` | Close to the timeout, with a resize still to run |
| DID document with a malformed endpoint | Yes, 1 account | 502 on every miss |
| Blob gone or account inactive | Not sampled | 404 or 502, per the PR #84 memo |

## Options

| Option | Fixes | Does not fix | Cost |
|---|---|---|---|
| A. No bucket, rely on the CDN | Hits during an outage (CDN serves the resized copy) | Misses during an outage | Zero build cost. `stale-if-error` adds nothing because the URL holds the CID and the one-year `max-age` means the entry is never stale before eviction (PR #84 reasoning) |
| B. Keep originals in object storage (R2) | Misses for any account whose original is stored, even if its PDS is down | The first fetch of a new avatar | About $15 per month per million 1 MB originals (PR #84 table), plus a write path with CID check, a delete path for takedowns, secrets, and a spec and privacy-policy change to the "nothing is stored" design |
| C. Keep an original only after the first successful fetch | Repeat misses at other sizes and after eviction, for every account that was served once | The first view, and any account never fetched | Same moving parts as B, but only for accounts with traffic, so storage tracks real use. The sample's 11% hard-failure share applies to the first view, so C does not touch it |

My reading of the numbers: the unreachable hosts were unreachable on all 3 tries, and with options B and C the original must already be stored before the outage. Only option B with indexer-time copying, or a prewarm that makes the first view a CDN hit, covers a new avatar on a host that is down at change time.

## Recommendation

Choose option A for v1 and add the mitigations below. Option C is the next step if production logs show a high share of repeat-miss failures. The measurement supports this: failures were concentrated on a minority of small hosts that failed on every try, and a bucket does not help an account whose avatar was never fetched while its host was up. Prewarming at change time, which the spec already proposes in section 4, does that job for the common case without storing originals.

**Cost of the recommendation.** My estimate, not a quote: 2 to 3 engineering days, no new service, no new bill.

1. **Log every `getBlob` outcome** (PDS host, status or error class, latency, bytes). This replaces my one-container sample with real numbers. About half a day. Keep the host label coarse for Bluesky hosts (one group) to limit cardinality.
2. **Split error handling.** Map PDS 404 and 400 to 404, and 5xx, timeout, and connection errors to 502 with a distinct log reason. Fixes the lost distinction in the table above.
3. **Short negative cache** for 5xx on `/img/*` through a Cloudflare Cache Rule, tested in staging (the PR #84 memo marks the Free plan behavior as unconfirmed).
4. **Prewarm** common sizes through the CDN when the indexer sees an avatar change (spec section 4).
5. **Short in-memory cache of originals**, bounded by bytes, so one avatar at several sizes costs one `getBlob`.
6. **Bounded retry** with randomized backoff on 5xx and 429, per the XRPC spec cited in PR #84. Keep it under the 5 second budget or raise the budget with care, since a miss holds a cache-lock slot.
7. **Validate the PDS endpoint** from the DID document (scheme and host) and log a clear reason on failure.

**Revisit trigger.** Set the number from the first month of staging logs. A reasonable starting rule is: if more than a fixed share of CDN misses fail on `getBlob` over 30 days, or a customer contract requires delivery independent of the PDS, build option C with R2. Do not pick the number now. This sample is too small, and the proxy confounds it.

## Limits of this memo

- One container, one proxy, one day, 82 accounts, 3 tries each. Indicative only.
- Failures at the proxy cannot be told apart from host outages.
- The sample came from search results, so it favors accounts that appear in search, not accounts that apps will request.
- No CDN hit rate is measured. How often a miss happens in production is unknown until staging runs.
- Option costs for B and C reuse the R2 prices already cited in the PR #84 memo. I did not re-check them.
