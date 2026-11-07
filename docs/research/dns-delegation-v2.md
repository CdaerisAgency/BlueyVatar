# DNS delegation to self-hosted servers (v1)

Design memo for issue #12 (feature F7, spec section 3 row 7, section 11.1). Sources are primary only, fetched November 7, 2026. "No published answer" means I found no primary source that states it. Statements marked "Proposal" are design choices of this memo, not facts from a source. No application code is changed by this memo.

## Recommendation

Use Libravatar's HTTPS SRV record, `_avatars-sec._tcp.<domain>`, as the single discovery mechanism. The hosted service honors it only for domains that an Enterprise account has registered and proved with a TXT challenge, never for an arbitrary domain a caller names. The first phase is the smallest useful one: a client-side discovery library and a reference setup guide, with no change to what the hosted service fetches.

Why SRV and not a new TXT format: Libravatar zones that already publish this record keep working with no new DNS work, and SRV carries a host and port, which is all a delegation needs. Why registration is required: the hash route (`/avatar/{sha256}`) carries no domain, so the service cannot discover a domain from the request, and fetching from a caller-chosen host is an SSRF and abuse risk (see "Security risks").

## What delegation means here

A domain owner (a company, a school, a community) runs its own blueyvatar-compatible server and publishes a DNS record that says "avatars for this domain live there." Lookups for people in that domain then resolve against the owner's server first. This is the model Libravatar uses, and the spec cites it for the Enterprise row "Delivery from your own domain or node" (spec section 11.1, [Libravatar API](https://wiki.libravatar.org/api/)).

Three scopes could be delegated. They differ in what the requester knows:

| Scope | Identifier in the request | Domain known to the requester? |
| --- | --- | --- |
| Email domain | `GET /avatar/{sha256}` | Only the party that holds the email address. The hash hides it. |
| Handle domain | `GET /u/{handle}` | Yes, a handle is a DNS hostname ([atproto handle spec](https://atproto.com/specs/handle)). |
| DID | `GET /u/{did}` | No. A DID has no domain unless it is `did:web`. |

This difference decides the design. Libravatar solves it by having the client library do the DNS lookup: its documented steps start from the email address, take the part after `@`, query SRV, and build the image URL ([Libravatar API](https://wiki.libravatar.org/api/)). The server never sees the domain. blueyvatar's hosted service sits where Libravatar's server sits, so a hosted-side lookup by hash needs the domain from somewhere else (see "Honoring delegation in the hosted service").

## How Libravatar does it (the prior art)

Facts from the [Libravatar API page](https://wiki.libravatar.org/api/):

- Lookup names are `_avatars._tcp.EMAILDOMAIN` for HTTP and `_avatars-sec._tcp.EMAILDOMAIN` for HTTPS.
- Clients "MUST only consider servers listed in the highest SRV priority" and "MUST honour relative weights."
- With no record found, clients fall back to `cdn.libravatar.org`, or `seccdn.libravatar.org` for HTTPS.
- "SRV records are cached for at least 1 day (or more if the TTL is greater than 1 day)."
- DNS results "MUST be sanitized," and the page's example removes a trailing dot from the host name.
- For OpenID hashes the page says the same steps apply but describes no SRV lookup for them. No published answer on OpenID delegation.
- No published answer on whether a delegated server returning "not found" should fall through to the central service. The page describes fallback only when no server is found.

The SRV record format, priority and weight selection, and the rule that a target of "." means the service is not offered come from [RFC 2782](https://www.rfc-editor.org/rfc/rfc2782). The same RFC says the target must not be an alias (a CNAME) and must have address records.

## How atproto handle resolution does it

Facts from the [atproto handle spec](https://atproto.com/specs/handle):

- DNS method: a TXT record at `_atproto.<handle>` whose value starts with `did=`. Values that do not start with `did=` are ignored. Multiple valid records naming different DIDs make resolution fail. DNSSEC is not required.
- HTTPS method: `/.well-known/atproto-did` on the handle's domain, over HTTPS on port 443, returning only the DID. Redirects are allowed up to a reasonable number of hops.
- Both methods can run in parallel. If they disagree, the DNS result is preferred, or the result is recorded as ambiguous and retried.
- DNS is the preferred method for individual handles. The HTTPS method is meant for large services that cannot create many TXT records.
- Services should cache results for a set lifetime. DNS TTLs "may be too short" to serve as that lifetime.
- Resolution must be confirmed in both directions: the DID document claims the handle and the handle resolves to the DID. Reserved TLDs such as `.onion`, `.local`, and `.arpa` must fail.
- The page does not discuss SSRF or cache poisoning. Its only redirect guidance is the hop limit. No published answer for either in the handle spec.

The DID spec adds a third place to publish a pointer. A DID document has a `service` array of entries with `id`, `type`, and `serviceEndpoint`. The endpoint must be an HTTPS URL with only scheme, host, and optional port. The spec says other applications may use `service` entries and gives AppView entries as the example, with no further rules ([atproto DID spec](https://atproto.com/specs/did)). That spec gives no caching guidance for DID documents (no published answer).

The lexicon spec bears on the profile-record option. Unexpected fields "should be ignored," but adding third-party fields to another app's record "is not the recommended way to extend applications" ([atproto lexicon spec](https://atproto.com/specs/lexicon)). It also ties namespace authority to DNS control of the domain.

## Discovery options compared

| Option | Record | Fits scope | Strengths | Weaknesses |
| --- | --- | --- | --- | --- |
| A. SRV (recommended) | `_avatars-sec._tcp.<domain>` | Email domain; also handle domain | Works with existing Libravatar zones. Carries host and port. Priority and weight give failover ([RFC 2782](https://www.rfc-editor.org/rfc/rfc2782)). | SRV is awkward in some DNS dashboards. Not usable from browser JavaScript, so lookups run server side or in a library. |
| B. TXT in the style of `_atproto` | `_blueyvatar.<domain>` with `url=...` | Any domain | Same shape domain owners already use for `_atproto` ([handle spec](https://atproto.com/specs/handle)). Easy in every DNS dashboard. | New format. No Libravatar compatibility. No priority or weight. |
| C. Well-known URL | `https://<domain>/.well-known/...` | Handle domain, owners with a web server | Needs no DNS access. Matches the atproto HTTPS method. | Every lookup costs an HTTPS fetch to a host the requester does not control (SSRF surface). Needs a web server on the domain. Gives nothing for email domains that host mail only. |
| D. Field in the user's atproto profile | New field in `com.blueyvatar.profile` | One user, not a domain | User controls it without DNS access. blueyvatar owns that lexicon, so it avoids editing another app's record ([lexicon spec](https://atproto.com/specs/lexicon)). | Per-user, not per-domain. A user could point lookups for their own DID at any host they like, so every request is a fetch to a user-chosen host. Adds an indexing path. The profile route already starts from the DID, so it needs no DNS at all. |
| E. DID document `service` entry | `#blueyvatar` service | One user | Signed by the DID's keys. Permitted by the DID spec ([DID spec](https://atproto.com/specs/did)). | Most users cannot edit their DID document. No published answer on how PDS software exposes edits to custom service entries. |

Decision: option A for domain delegation. Options D and E are per-user pointers, a different feature ("my avatar lives on my own server"), and are out of scope for F7. They are listed only to show the choice was weighed.

Discovery order (Proposal):

1. Local registration check. If the domain is not registered to an Enterprise account, stop. Delegation is off.
2. SRV `_avatars-sec._tcp.<domain>`. Use only the highest-priority group and pick by weight, as Libravatar requires. A target of "." means no delegation.
3. If the delegated server answers 404 or errors, continue with the normal local resolution order (spec section 7) and apply the caller's `d=` default last. Libravatar's page does not say what to do here (see above), so this is a blueyvatar choice. The reason: a broken self-hosted server should not turn every avatar in the domain into the default image.

The HTTP variant `_avatars._tcp` is not used. The hosted service only fetches over HTTPS.

## Security risks

| Risk | How it applies | Mitigation (Proposal unless cited) |
| --- | --- | --- |
| SSRF on fetch | The service connects to a host named by DNS data the domain owner controls. That host can resolve to `127.0.0.1`, a Fly private address, or a cloud metadata address. OWASP lists this class under SSRF. | Follow the [OWASP SSRF cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html): allowlist trusted destinations (here, registered domains), build the URL yourself with a fixed scheme and path, resolve then validate every A and AAAA answer then connect to the validated address, disable redirects, and restrict egress. The repo already has this pattern for verification fetches in `packages/core/src/verification/safe-fetch.ts` (private-address check inside the socket lookup, size limit, timeout). It returns text, so image fetching needs a binary variant with the same guards. |
| Open fetch from arbitrary domains | If any caller can name a domain, the service becomes a request cannon aimed at third parties and a way to probe internal names. | Delegation applies only to registered domains. A request cannot introduce a new domain. |
| Spoofing at registration | Only a domain's owner can publish its SRV record, so the weak point is the registration step, where someone could claim a domain that belongs to another party. | Registration requires a TXT challenge at `_blueyvatar-challenge.<domain>` (Proposal), re-checked on a schedule. If the challenge disappears, delegation is disabled. This is the same proof pattern as Keyoxide's DNS proof and `_atproto` ([decisions-phase2-v1.md](decisions-phase2-v1.md), [handle spec](https://atproto.com/specs/handle)). |
| DNS cache poisoning | A forged SRV answer sends fetches to an attacker's server. [RFC 5452](https://www.rfc-editor.org/rfc/rfc5452) describes the attack and says resolvers must use unpredictable source ports and query IDs. It notes attackers who can observe or inject traffic are not fully blocked, and points to DNSSEC ([RFC 4033](https://www.rfc-editor.org/rfc/rfc4033)) for stronger protection. | Use a validating or well-run recursive resolver. Treat DNSSEC as optional, as atproto does ([handle spec](https://atproto.com/specs/handle)). The blast radius is bounded because the attacker's server can only supply avatar images for registered domains, and every image is treated as untrusted bytes (next row). |
| Malicious image bytes | A delegated server returns a decompression bomb or a malformed file. | Keep spec section 14 rules: blobs go through the service's proxy and the sandboxed, resource-limited resize worker, never straight to the viewer. Cap download size, enforce content type and pixel limits. Never redirect viewers to the delegated host. |
| Impersonation across users | A domain owner can serve any image for any hash in their domain. | This is the owner's right for their own domain's email addresses. Delegation never covers hashes or handles outside registered domains. A hash linked to an address in another domain is never sent to the delegate. |
| Privacy leak | Sending a hash to a delegated server tells the owner that someone requested it, and requests expose the service's server IP. | Send only the hash and size. Never forward viewer IP, cookies, referrer, or API key. Say so in the setup guide. |
| Enumeration | A delegated 200 versus 404 could reveal whether an address exists. | The service keeps spec section 9's uniform response for hash lookups. It must not leak the delegate's outcome in status, headers, or timing beyond the normal path. |
| Redirect and `d=` abuse | A delegate answers with a redirect to an internal or hostile URL. | Redirects are disabled (OWASP). Libravatar also prohibits redirects to external sites from `d=` ([Libravatar API](https://wiki.libravatar.org/api/)). |
| Look-alike domains | Registrations of near-identical domains. | Registration is a paid, reviewed Enterprise action. The handle spec flags look-alike risk ([handle spec](https://atproto.com/specs/handle)). |
| Host name sanitation | Trailing dots and odd characters in SRV targets. | Lower-case, strip one trailing dot, reject non-hostname characters and IP literals, reject reserved TLDs (`.onion`, `.local`, `.arpa`), as Libravatar and the handle spec require ([Libravatar API](https://wiki.libravatar.org/api/), [handle spec](https://atproto.com/specs/handle)). |

## Honoring delegation in the hosted service

### Hash lookups (`/avatar/{sha256}`)

The request has no domain, and the service stores no readable email addresses (spec section 9). Two ways to get the domain:

1. At link time. When a user links an email address, the service already sees the address once. If the domain is registered, it records the domain on the link row next to the hash. Later lookups of that hash check the delegation. No change to the public URL shape. This is the recommended path (Proposal). It stores a domain name, which is less sensitive than the address, but it is still data about the user, so the privacy page must mention it.
2. At request time. The caller adds a domain parameter. This changes the URL and leaks the domain to every cache and log in the path, and it works only for callers that know the email. Not recommended.

Hashes that were never linked on the hosted service have no recorded domain. A delegated server can still answer them through client-side discovery (phase 1), which is the Libravatar model.

### Handle lookups (`/u/{handle}`)

The handle is a hostname, so the domain is known. The service checks whether the handle's registrable domain (or the handle itself) is registered, then follows the same SRV discovery. The delegate receives the handle's `sha256` over the lowercased handle at `/avatar/{hash}`, so one delegate protocol serves both scopes (Proposal). The handle must first pass the normal bidirectional check from the [handle spec](https://atproto.com/specs/handle), so delegation never applies to a handle that does not resolve to the DID. DID-only lookups are not delegated.

### Serving the result

Fetch from the delegate server side, pass the bytes through the sandboxed resize worker, and serve them under a signed immutable path in the same style as `/img` (spec section 7). The viewer never talks to the delegate. A new path family keyed by registered domain and content hash is needed because delegated images have no DID or CID (Proposal). This keeps the blob-proxy and sandbox rules the issue requires (spec section 14, rules 1 and 2).

Entitlement: delegation is an Enterprise capability (spec section 11.1). Registration, challenge status, and the delegate's last-seen health live with the account's license record.

Relation to custom profile domains: Cloudflare for SaaS (deploy.md, step 6, and Decision 2 in [decisions-phase2-v1.md](decisions-phase2-v1.md)) serves blueyvatar profile pages on a customer's hostname, which is inbound traffic to blueyvatar. Delegation is outbound traffic from blueyvatar to the customer. They share only the TXT proof idea. The Cloudflare path does not touch delegation, and Fly's outbound fetches do not pass through Cloudflare's proxy.

## Caching and TTL rules (Proposal)

| Item | Rule | Basis |
| --- | --- | --- |
| Registration challenge (TXT) | Re-check every 24 hours. Disable delegation after 3 consecutive failed checks that return a definite "no such record," not after resolver errors. | Bounds how long a revoked domain stays active. |
| SRV positive answer | Cache for the DNS TTL, clamped to between 1 hour and 24 hours. | Libravatar says "at least 1 day." This memo chooses a 24 hour ceiling so a domain owner who removes or changes the record is honored within a day. That differs from Libravatar and is a deliberate choice. The handle spec also says DNS TTLs may be too short to use directly, hence the 1 hour floor. |
| SRV negative answer (no record) | Cache 1 hour. | [RFC 2308](https://www.rfc-editor.org/rfc/rfc2308): negative TTL is the lower of the SOA MINIMUM and the SOA TTL, and values of one to three hours work well. Over a day has caused problems. |
| Resolver failure (SERVFAIL, timeout) | Cache 5 minutes. Keep serving the last good answer for up to 24 hours more while failing. | Avoids hammering a broken zone. RFC 2308 does not cover this case, so the numbers are a proposal. |
| Delegate image response | Cache the processed result under the immutable path. Revalidate the source on a 24 hour TTL, matching the Free tier's fixed redirect TTL (spec section 11.1). Do not trust the delegate's `Cache-Control` above 24 hours. | A delegate cannot pin stale or hostile content for a year. |
| Delegate 404 or error | Cache 5 minutes, then fall through to local resolution. | Keeps a flapping server from slowing every request. |
| Redirect from `/avatar` to `/img` | Unchanged: `private, max-age=<ttl>` (spec section 14.1, rule 3). | Cloudflare does not cache `private`, so the registration and entitlement checks still run on each pass through. |
| Purge | A purge route for a registered domain, tied to the account, flushes that domain's cached images and SRV state. | Gives owners a way to force changes before the TTL ends. |

All lookups use a hard time limit (Proposal: 2 seconds for DNS, 3 seconds to first byte, 5 seconds total, 2 MiB maximum body). A slow delegate then costs the service at most one time-limited attempt per cache window.

## Phased plan

| Phase | Scope | Changes the hosted service? |
| --- | --- | --- |
| 0 (this memo) | Decide the design. | No |
| 1 (smallest useful step) | Publish the record format, a self-hosting section ("serve `/avatar/{sha256}` from your domain and publish `_avatars-sec._tcp`"), and a small client-side discovery helper that does the SRV lookup (priority, weight, sanitation) and falls back to `blueyvatar.com`. Domain owners with their own server and callers who know the email address get working delegation with no hosted-side fetch. | No. It adds docs and a client helper only. The fetch rules live in the helper. |
| 2 | Domain registration and TXT challenge in the Enterprise dashboard. Store the domain on link rows. Hosted-side SRV lookup, safe binary fetch, delegated serving through the sandbox, caching rules above. Behind a flag, off by default. | Yes |
| 3 | Handle-domain delegation for `/u/{handle}`. Health checks and owner-facing status in the dashboard. Purge route. | Yes |
| Later | Per-user pointers (options D and E), only if users ask. | Yes |

Phase 1 is the smallest step that delivers value: it uses no new fetch path from blueyvatar's servers, so it carries none of the hosted-side SSRF risk, and it matches how Libravatar delegation works today.

## Acceptance criteria from issue #12

- DNS record format and discovery order: "Discovery options compared" (record `_avatars-sec._tcp.<domain>`, order above).
- Delivery checks delegation before resolving locally, with DNS caching: "Honoring delegation in the hosted service" and "Caching and TTL rules" (phase 2).
- Blob proxy and sandbox rules kept: "Serving the result."
- Setup documentation for domain owners: phase 1.

## Open questions for the owner

1. Is Enterprise-only registration acceptable, or should Pro and Business plans get delegation too?
2. Should a delegate 404 fall through to local resolution (recommended here) or end in the default image?
3. Is storing the registered email domain on the link row acceptable under the privacy policy? Answered by the owner: yes, the domain only and never the full address, stored at link time. Migration 0016 adds `email_links.email_domain`, and `/privacy` discloses it. The domain is stored for every linked address, not only for registered domains, because registration does not exist yet.
4. Libravatar's page does not describe delegation for OpenID hashes, so it is out of scope unless the owner wants it.

## Sources

- Libravatar API: <https://wiki.libravatar.org/api/>
- atproto handle spec: <https://atproto.com/specs/handle>
- atproto DID spec: <https://atproto.com/specs/did>
- atproto lexicon spec: <https://atproto.com/specs/lexicon>
- RFC 2782 (SRV): <https://www.rfc-editor.org/rfc/rfc2782>
- RFC 2308 (negative caching): <https://www.rfc-editor.org/rfc/rfc2308>
- RFC 5452 (DNS forgery resilience): <https://www.rfc-editor.org/rfc/rfc5452>
- RFC 4033 (DNSSEC introduction), cited only through RFC 5452's pointer: <https://www.rfc-editor.org/rfc/rfc4033>
- OWASP SSRF Prevention Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html>
- In-repo: spec sections 3, 7, 9, 11.1, 14 and 14.1 (`docs/spec/blueyvatar-product-spec-v7.md`), `docs/self-hosting-v1.md`, `docs/deploy.md`, `docs/research/decisions-phase2-v1.md`, `packages/core/src/verification/safe-fetch.ts`
