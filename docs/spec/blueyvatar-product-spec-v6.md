# blueyvatar - Product Spec v6

Nov 3, 2026 by @Chris Duncan

## 1. Overview

This spec defines blueyvatar (blueyvatar.com), a Gravatar-style avatar and profile service where avatars and profile data live in each user's atproto repository, and the service adds email lookup, fast delivery, and paid developer tiers on top.

Build instructions live in the repository README at the repo root, and this spec lives in `docs/spec/` in the same repository.

**Goals**

- Any app can fetch a user's avatar by email hash, handle, DID, or domain with one image URL.
- The user's data stays in their own atproto repository, so the user can move providers without losing their avatar or profile.
- Core avatar delivery is free. Higher volume, custom domains, analytics, and commercial licensing are paid.
- Developers receive licenses (keys with entitlements). Users receive permission controls over who can fetch their avatar and profile.

**Assumptions to confirm**

1. "Licensing" covers two things: developer licenses (API keys with tier entitlements) and an optional usage license that a user can declare on each image.
2. "Permissions" covers two things: user-set rules on who can fetch avatar and profile data, and the OAuth permissions an app requests from the user.
3. Tier names (Free, Pro, Business, Enterprise) and all prices are placeholders. No published basis exists for pricing this product, so section 11 lists competitor reference points only.
4. Version 1 targets web and API delivery. Mobile SDKs and WordPress plugins are listed as later phases.

**Scope of this version**

This is a product spec. It defines what the service does and why, and leaves build sequencing to the implementation work. Items with no published answer are listed as open in section 13.

## Changes in v6

- Package versions updated to those on npm on November 3, 2026, and `lex build` for local lexicons is now documented (section 14).
- Image resizing uses sharp 0.35.5 in a forked child process with a heap cap and a timeout, recorded as a design decision with sharp's input limits sourced (sections 13 and 14).
- Redirect responses now send `Cache-Control: private, max-age=<ttl>`, a proposal with its trade-off stated (sections 7, 12, and 14.1).
- New requirement: verify fetched blob bytes against the CID before caching (section 7).
- New open risk: the `/img` route can bypass a tier's size cap (sections 7 and 13).
- Research results added for the visitor IP header, Free plan cache rules, the Tangled avatar field, the `!no-unauthenticated` label, and OAuth scope syntax (sections 7, 10.1, and 13).
- Wording fixes: removed contrast phrasing, merged the duplicate authority sentence in section 14, and replaced the pointer to the old brief tab.

## 2. Competitive baseline

No service found combines email-hash lookup, federation, a hosted profile page, and atproto identity. Each competitor covers one or two of those.

| Service | Lookup keys | Hosted profile page | Federation | Cost model | atproto |
| --- | --- | --- | --- | --- | --- |
| [Gravatar](https://docs.gravatar.com/api/images/) | Email hash (SHA256), profile slug | Yes | None found in docs | Free avatars; custom domains and add-ons are paid | No |
| [Libravatar](https://wiki.libravatar.org/api/) | Email hash (MD5 or SHA256), OpenID hash | None found in docs | Yes, DNS SRV records | Free, open source, self-hostable | No |
| [Unavatar](https://github.com/microlinkhq/unavatar) | Username, email, domain, phone across 99 providers | No | None; chains other providers | 25 anonymous requests per day per IP free; PRO at $0.010 per token | Bluesky by handle only |
| [atp.pics](https://graham.leaflet.pub/3mhr36lsmo222) | Handle, DID, other Atmosphere identifiers | No | Falls back across several atproto profile records | Free | Yes, read-only |

The open space is email-to-DID linking, a user-controlled avatar and profile record shared across atproto apps, and a licensing layer. atp.pics' author says the ecosystem [still needs a standard for actor profiles](https://graham.leaflet.pub/3mhr36lsmo222) and is only considering a lexicon for user-set resolution order.

One caution for pricing: Unavatar's [January 2026 launch post](https://microlink.io/blog/unavatar-generally-available) listed $0.001 per token, and an earlier README snapshot listed 72 platforms. Its README, updated October 15, 2026, lists $0.010 per token and 99 platforms. Use the README figures.

## 3. Combined feature requirements

Thirty features come from the four competitors, and each maps to an atproto mechanism below. Phase is a proposal: v1 is the launch set, v2 and Later follow.

Seen in: G Gravatar, L Libravatar, U Unavatar, A atp.pics.

| # | Feature | Seen in | atproto mapping | Phase |
| --- | --- | --- | --- | --- |
| 1 | Lookup by email hash | G, L | Service index maps SHA256 of a verified email to a DID (section 6) | v1 |
| 2 | Lookup by handle or DID | A, U | Resolve handle to DID, DID document to PDS, then read the record | v1 |
| 3 | Lookup by domain | U | Domain-style handles resolve to a DID like any other handle | v1 |
| 4 | Hash-only input, never raw email in URLs | U | API accepts SHA256 hashes only | v1 |
| 5 | OpenID hash lookup | L | Not carried over. DID and handle lookup serve the same need | None |
| 6 | Fallback chain across records | A, U | Service avatar record, then app.bsky.actor.profile, then other profile records, then default | v1 |
| 7 | DNS delegation to self-hosted servers | L | Optional Libravatar-style SRV discovery for domain owners | Later |
| 8 | Gravatar-compatible URL scheme | L | /avatar/{hash} with s, d, f, r parameters | v1 |
| 9 | Size parameter | G, L | Service resizes the stored blob; maximum set in section 7 | v1 |
| 10 | Default image styles | G, L, U | Generated styles, custom URL, or 404 | v1 |
| 11 | Force default | G, L | Query parameter | v1 |
| 12 | Content rating filter | G | Map ratings to atproto self-labels (section 9) | v1 |
| 13 | Format and quality transforms | A | Width, height, quality, format parameters | v2 |
| 14 | JSON response mode | U | json parameter returns metadata | v1 |
| 15 | Redirect to CDN-cached image | A | Immutable cached copies keyed by blob CID | v1 |
| 16 | Cache TTL control | U | Tier-gated TTL parameter | v2 |
| 17 | Hosted profile page | G | Rendered from the service profile record plus app.bsky.actor.profile | v1 |
| 18 | Extended profile fields | G | Fields in the service profile lexicon (section 5) | v1 |
| 19 | Verified accounts | G | Verification records plus service attestation (section 8) | v2 |
| 20 | Links | G | Reuse the links field in the Bluesky profile lexicon | v1 |
| 21 | Image gallery | G | Extra blobs in the user repo | Later |
| 22 | Hovercards | G | Embeddable script reading the profile API | v2 |
| 23 | QR code | G | Endpoint returning a QR for the profile URL | v2 |
| 24 | Multiple avatars with ratings | G | One record per avatar in a collection | v1 |
| 25 | Sign-in and account management | G, L | atproto OAuth, no passwords held | v1 |
| 26 | Import existing avatars | L | Import from Gravatar, Libravatar, and the Bluesky profile | v2 |
| 27 | Secret and publishable API keys with domain limits | U | Keys tied to a license record (section 10) | v1 |
| 28 | Rate limit headers and stable error codes | U | Response headers and error schema | v1 |
| 29 | Custom profile domains | G | Paid tier feature | v2 |
| 30 | Open source and self-hosting | L, A | Publish the delivery layer under an open license | Later |

## 4. atproto architecture

Users keep their avatar and profile records in their own PDS, and the service indexes them, serves the images through a CDN, and answers every delivery request, so the user's data survives if the service shuts down.

&#91;embedded content: architecture · 4 service components, 5 outside parties\]

The web app writes the user's records through OAuth. The indexer follows the firehose to learn of changes. The delivery API resolves identities and fetches blobs from the PDS only when the CDN has no copy of the resized image. Apps send an API key, and Cloudflare's free CDN serves repeat requests for the same image.

**Components**

- **Web app:** sign-in, record editor, profile pages, and the account and license dashboard.
- **Indexer:** runs [Tap](https://atproto.com/guides/backfilling), Bluesky's sync tool, and updates the database when avatar, profile, or claim records change. Tap's signal collection is the service profile record, so users are discovered when they create it. Its collection filters cover the three service collections plus the Bluesky profile, and apply only to tracked users, per Tap's own README. After an avatar changes, the indexer can request the common sizes through the CDN so the first visitor gets a cached image (a proposal).
- **Delivery API:** the routes and parameters in section 7, with the entitlement check from section 12. It resizes in a sandboxed process when the CDN has no copy.
- **Database:** email hash to DID (section 6), visibility rules, licenses, and usage counters. It holds an avatar only when the user picks a service-stored image (section 10.2).
- **Cloudflare free CDN:** caches the resized images and provides DNS, DDoS protection, and TLS for blueyvatar.com (section 14.1). Nothing else from Cloudflare is used.
- **Identity lookup:** a handle resolves to a DID, and the DID document names the user's PDS. atp.pics works the same way: it [resolves the user's PDS and reads the profile record](https://graham.leaflet.pub/3mhr36lsmo222).

**Failure behavior.** The avatar stays in the user's repo if the service goes down, and any other app can still read it. That portability is the main difference from Gravatar.

## 5. Lexicons and data model

The service defines three record types in the user's repository and keeps everything else in its own database. Atproto lexicon IDs use reverse-DNS names, so the service namespace is `com.blueyvatar`, taken from blueyvatar.com. These IDs are hard to change once other apps depend on them, so the name needs clearance first (section 13).

| Record | NSID | Record key | Where it lives | Purpose |
| --- | --- | --- | --- | --- |
| Avatar image | `com.blueyvatar.image` | tid | User repo | One image blob with rating, alt text, license, and default flag |
| Profile | `com.blueyvatar.profile` | literal:self | User repo | Extended fields and the chosen default avatar |
| Link claim | `com.blueyvatar.claim` | tid | User repo | A claim of ownership of an outside account or URL |
| Attestation | `com.blueyvatar.attestation` | tid | Service repo | The service's signed result for a claim, pointing at it by strong reference |
| Email link | none | none | Service database only | Hash of a verified email mapped to a DID (section 6) |
| Permission rules | none in v1 | none | Service database | Who may fetch each avatar and profile field (section 10) |

**Reuse the Bluesky profile where it fits.** The Bluesky profile record already holds display name, description, an avatar blob that [accepts PNG and JPEG up to 1,000,000 bytes](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/actor/profile.json), self-labels, and a links list capped at 10 items. The service reads it as the fallback source and does not copy it.

**Avatar image record (draft).**

```json
{
  "lexicon": 1,
  "id": "com.blueyvatar.image",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["image", "createdAt"],
        "properties": {
          "image": { "type": "blob", "accept": ["image/png", "image/jpeg"], "maxSize": 1000000 },
          "alt": { "type": "string", "maxGraphemes": 300 },
          "labels": { "type": "union", "refs": ["com.atproto.label.defs#selfLabels"] },
          "license": { "type": "string", "knownValues": ["personal", "cc-by", "cc-by-nc", "all-rights-reserved"] },
          "isDefault": { "type": "boolean" },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

The blob limits copy the Bluesky avatar field so a user can reuse one file in both places. The license values are placeholders for the user-declared license in section 10.

**Two constraints shape this model.**

1. [All data stored on atproto today is public](https://atproto.com/blog/atproto-spaces-alpha). Anything written to the user repo, including avatar blobs and ratings, can be read by anyone. Private rules cannot live in these records.
2. An email address must never be written to a public record, even hashed (section 6).

## 6. Email-to-identity linking

Email lookup is the one Gravatar mechanic no atproto service offers, and atproto's OAuth scopes make a verified link possible without building a separate sign-up system. The PDS returns the account email and its confirmation status to an app that holds the `account:email` scope, [per the PDS source](https://cdn.jsdelivr.net/npm/@atproto/pds@0.4.218/src/api/com/atproto/server/getSession.ts). That scope [cannot be bundled into a permission set](https://atproto.com/guides/permission-requests), so the app requests it directly.

**Linking flow**

1. The user signs in with atproto OAuth. Requested scopes: `atproto`, write access to the three user-repo collections (scope forms in section 10.1), `blob:image/*`, and `account:email` for the linking step only.
2. The service calls `com.atproto.server.getSession` and reads `email` and `emailConfirmed`.
3. If the email is confirmed and the user's PDS host is on a trusted list, the link is created. Otherwise the service emails a one-time code and the user enters it.
4. The service stores SHA256 of the trimmed, lowercased email (the same hash [Gravatar uses](https://docs.gravatar.com/guides/llms-txt/)) mapped to the user's DID. The raw email is discarded after verification.
5. Additional emails are added the same way, by one-time code.
6. Unlinking deletes the mapping immediately.

**Design rules**

- The email hash lives only in the service database. A hash of an email is easy to test against a list of known addresses, so it must not be written to a public repo record.
- The code fallback is needed because a self-hosted PDS can report any email address. Whether the trusted-host list is workable is an open question (section 13).
- The delivery API accepts only hashes. Unavatar's docs warn that a [raw email in a URL is visible in server logs and to intermediaries](https://github.com/microlinkhq/unavatar), and recommend sending a precomputed hash instead.
- The service requests `account:email` once, for linking, and does not keep a long-lived session with that scope.

## 7. Avatar delivery API

The delivery API keeps Gravatar's URL shape so existing integrations switch by changing a base URL, and adds atproto identifiers as a second route. Libravatar [made the same compatibility choice](https://wiki.libravatar.org/api/).

**Routes**

- `GET /avatar/{sha256}` looks up a verified email hash.
- `GET /u/{handle-or-did}` looks up an atproto identity, the same pattern atp.pics uses with [`GET /{identifier}`](https://graham.leaflet.pub/3mhr36lsmo222).
- `GET /profile/{sha256-or-handle-or-did}` returns profile JSON (section 8).

**Query parameters**

| Parameter | Meaning | Default | Limits |
| --- | --- | --- | --- |
| `s` | Size in pixels, square | 80 | 1 to 2048; larger values are clamped. Tier caps in section 11 |
| `d` | Default when no image exists | Service silhouette | `404`, `mp`, `identicon`, `monsterid`, `wavatar`, `retro`, `robohash`, `pagan`, `initials`, or a public HTTPS URL on an allowlist |
| `f` | Force the default image | off | `y` |
| `r` | Highest rating to show | `g` | `g`, `pg`, `r`, `x` |
| `fmt` | Output format | `png` | `png`, `jpeg`, `webp` |
| `q` | Output quality | 85 | 1 to 100 |
| `json` | Return image metadata as JSON | off | `true` |
| `ttl` | How long a browser keeps the redirect (see Delivery behavior) | 24h | Tier-gated, 1h to 28d |

The default list combines [Libravatar's special values](https://wiki.libravatar.org/api/) with an initials style that Gravatar's WordPress plugin added. The size ceiling matches [Gravatar's 2048 px](https://docs.gravatar.com/api/images/). Quality 85 mirrors the sample key in [atp.pics' code](https://tangled.org/graham.systems/atp.pics/blob/optimize-resolution/internal/fetch/fetch.go).

**Resolution order for an identity**

1. The user's default `com.blueyvatar.image` that passes the rating filter.
2. Any other service avatar image that passes the rating filter.
3. The avatar in `app.bsky.actor.profile`.
4. Other atproto profile records, such as the Tangled profile, as [atp.pics does](https://graham.leaflet.pub/3mhr36lsmo222).
5. The default from `d`.

**Profile source adapters.** Steps 3 and 4 above run through adapters. An adapter is a configuration entry that says where one atproto app keeps its avatar, so supporting another app's profile record needs no new code. Unavatar uses the same pattern: each provider [declares the inputs it supports and supplies a function that fetches the avatar](https://deepwiki.com/microlinkhq/unavatar).

| Adapter field | Meaning | Bluesky example |
| --- | --- | --- |
| `collection` | NSID of the profile record | `app.bsky.actor.profile` |
| `rkey` | Record key | `self` |
| `avatarPath` | Field that holds the avatar blob | `avatar` |
| `labelsPath` | Field that holds self-labels | `labels` |
| `accept` | Image types allowed | `image/png`, `image/jpeg` |
| `priority` | Order in which adapters are tried | 1 |
| `enabled` | Switch to turn the adapter off | on |

The Bluesky values come from its [profile lexicon](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/actor/profile.json). A second adapter could cover the Tangled profile, which atp.pics [already tries as a fallback](https://graham.leaflet.pub/3mhr36lsmo222) under the collection `sh.tangled.actor.profile`. Tangled's lexicon source confirms the field name: the [`sh.tangled.actor.profile` lexicon](https://tangled.org/tangled.org/core/blob/02d9ff54fcdb96ae5665feb794aa14ba24302a79~1/lexicons/actor/profile.json) keeps the avatar in a blob field named `avatar` that accepts PNG and JPEG up to 1,000,000 bytes, matching Bluesky's limits. A [commit to Tangled's core repo dated November 2, 2026](https://tangled.org/tangled.org/core/commit/02d9ff54fcdb96ae5665feb794aa14ba24302a79) removed the `sh.tangled.*` lexicons it describes as unused, including that file, and the main branch now defines [`org.tangled.actor.profile`](https://tangled.org/tangled.org/core/blob/master/lexicons/org/tangled/actor/profile.json) with the same `avatar` field and limits. A Tangled adapter would use `avatarPath` `avatar` and `labelsPath` `labels` (the new lexicon adds self-labels). Which collection holds users' existing Tangled profiles is an open item (section 13).

**Adapter rules**

1. For each adapter in priority order, read the record with `com.atproto.repo.getRecord`, take the blob named by `avatarPath`, and apply the rating from `labelsPath`.
2. The first adapter that returns an image passing the rating filter wins.
3. An adapter that errors or returns nothing is skipped and logged. It never fails the request.
4. Each adapter ships with a test fixture, and an operator can disable one if its lexicon changes.
5. User-set adapter order is a later phase. atp.pics' author is [considering a lexicon for it](https://graham.leaflet.pub/3mhr36lsmo222), and it would add a field to the profile record in section 5.

**Delivery behavior**

- Respond with a redirect to an immutable image URL shaped like `/img/{did}/{cid}/{size}.{ext}`. The path ends in a file extension and the service sends `Cache-Control: public, max-age=31536000, immutable`, so Cloudflare's free CDN [caches it by default](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/). The resize runs only when the CDN has no copy. The redirect route has no extension and is not cached by default. atp.pics [follows the same split: cached objects are immutable for one year and the redirect is left uncached](https://tangled.org/graham.systems/atp.pics/raw/optimize-resolution/README.md), so browsers re-check for avatar changes.
- Redirect caching (proposal, taken in the scaffold). The extensionless redirect responses send `Cache-Control: private, max-age=<ttl>`, where `<ttl>` comes from the `ttl` parameter (default 24h). Cloudflare [does not cache a response marked private](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/), so every redirect the CDN passes on still goes through the key check, and the browser keeps the redirect for the ttl. The trade-off: repeat views in one browser skip a round trip to the service, and an avatar change reaches that browser only after up to one ttl. This departs from atp.pics, which leaves the redirect uncached.
- The `/img` route is publicly fetchable at any size up to 2048. Image URLs carry no key (section 14.1), so a caller can bypass a tier's size cap from section 11 by building `/img` URLs directly. This is an open risk (section 13).
- Return rate-limit headers named like Unavatar's: `x-rate-limit-limit`, `x-rate-limit-remaining`, `x-rate-limit-reset`, plus `x-cache-status`.
- Return stable machine-readable error codes with a documentation link.
- Add `x-tier` and a usage cost header on keyed requests (section 12).

**Image safety (from the atproto.com blob spec).** Applications [must proxy blobs through an independent CDN or web service before serving them to browsers](https://atproto.com/specs/blob), and servers are strongly advised against parsing media files without strong sandboxing. So the delivery API never sends a browser to a PDS blob URL, and resizing and format conversion run in an isolated, resource-limited worker. The original is fetched from the PDS with `com.atproto.sync.getBlob`.

**Requirement: verify blob bytes against the CID.** Image URLs are keyed by blob CID and cached as immutable for a year, so a wrong image would stay cached under that CID. Before resizing and caching, the delivery API must hash the fetched bytes and confirm they match the CID it requested. A mismatch fails the request, nothing is cached, and the event is logged. The scaffold implements this check in [cid.ts](../../apps/delivery/src/cid.ts).

## 8. Profile, verified accounts, hovercards, QR codes

The profile layer reuses the Bluesky profile for basics and adds only the fields Gravatar users rely on. Gravatar's [data model](https://docs.gravatar.com/rest/api-data-specifications/data-models) is the reference for field names.

| Field | Source | Phase |
| --- | --- | --- |
| Display name, description, avatar | `app.bsky.actor.profile` | v1 |
| Links (up to 10) | Links field in `app.bsky.actor.profile` | v1 |
| Job title, company, location | `com.blueyvatar.profile` | v1 |
| Pronouns, pronunciation, timezone, interests | `com.blueyvatar.profile` | v1 |
| Background color | `com.blueyvatar.profile` | v2 |
| Verified accounts | Claim and attestation records | v2 |
| Contact info, payment and wallet links | `com.blueyvatar.profile` with visibility rules | Later |
| Gallery images | Extra `com.blueyvatar.image` records | Later |

**Verified accounts.** Gravatar lets users [link and verify accounts such as Instagram, GitHub, TikTok, and Threads](https://www.sqlservercentral.com/blogs/beyond-avatars-how-gravatar-is-transforming-online-identity), and its API [caps unauthenticated responses at four](https://docs.gravatar.com/rest-api). The v2 design is a claim record in the user repo and an attestation record in the service repo that points at the claim. The profile API returns only claims that have an attestation. No source I read documents how Gravatar performs each verification, so the verification methods per platform are an open item (section 13).

**Re-verification and revocation.** The indexer re-checks attested claims on a timer. Every `REVERIFY_INTERVAL_HOURS` (default 24) it selects claims whose last successful verification (`attestations.verified_at`) is older than `REVERIFY_AFTER_DAYS` (default 30), and re-runs the verifier in batches of 50 with a short pause between batches. Each attempt stamps `last_checked_at`. A success resets `fail_count` to 0 and restarts the 30 day window. A failure adds 1 to `fail_count`. The third consecutive failure revokes the claim: the attestation record is deleted from the service repo, the index row is marked `revoked`, and the badge disappears from the profile JSON, the profile page, and delivery. A claim that fails at 3 days of checks therefore loses its badge about 33 days after verification. Failures that say nothing about the claim (HTTP 5xx or 429, network errors, a missing handle) do not count. rel="me" claims re-run the same reciprocal-link check as the claims page. GitHub and Mastodon claims were proven with OAuth, and the token is not kept, so the re-check confirms only that the account still exists at the claimed address. The user is emailed once on revocation. The service stores only email hashes (section 6), so no address is available to the indexer today and the notice is skipped with a log line until an address source is chosen.

**Profile page.** A hosted page at `/p/{handle}` renders the profile, and the same data is available as JSON at the profile route in section 7. A user's handle works as the page slug, so no separate username system is needed.

**Hovercards.** A small embeddable script shows a profile card when a visitor hovers an avatar. Gravatar ships this as an [npm package and WordPress block](https://fao.wordpress.org/plugins/?p=12258). Verified accounts the user chose to hide are omitted from the card.

**QR code.** An endpoint returns a QR code for the profile URL, with a size parameter, as Gravatar [offers](https://docs.gravatar.com/guides/llms-txt/).

## 9. Ratings, safety, and privacy

Gravatar's four ratings map onto atproto's existing self-label values, so ratings travel with the image and other apps can read them. The mapping below is a proposal. The values atproto supports for self-labeling are [`!no-unauthenticated`, `porn`, `sexual`, `nudity`, and `graphic-media`](https://docs.bsky.app/docs/advanced-guides/moderation).

| Rating | Meaning | Self-label on the image record |
| --- | --- | --- |
| G | Suitable for all audiences | No label |
| PG | Non-sexual nudity or mild content | `nudity` |
| R | Sexually suggestive or graphic media | `sexual` or `graphic-media` |
| X | Adult content | `porn` |

Bluesky describes `nudity` as a warning label that [is not 18+ and defaults to ignore](https://docs.bsky.app/docs/advanced-guides/moderation), which is why it sits at PG. Gravatar shows [only G-rated images unless the caller asks for more](https://docs.gravatar.com/api/images/), and the service keeps that default.

**Rules**

- The image record's labels set its rating. The service does not accept a rating that conflicts with a label.
- Self-labels on the Bluesky profile apply to the [overall account](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/actor/profile.json). If the account carries `porn` or `sexual`, the Bluesky fallback avatar is rated X or R.
- Users can report an avatar. The service can remove it from delivery and caches without touching the user's repo.
- The service stops serving avatars for accounts whose repo is no longer active (taken down, suspended, or deactivated).
- The service never stores raw email addresses, never sets tracking cookies on avatar requests, and keeps request logs for a short, published period.
- Embed guidance tells sites to add a no-referrer policy to avatar images, as [Libravatar recommends](https://wiki.libravatar.org/api/).

**What the service cannot promise.** Public atproto data is [rebroadcast by a global firehose](https://atproto.com/blog/atproto-spaces-alpha). When a user deletes an image record, the service purges its own caches, but it cannot recall copies that others already hold.

## 10. Licensing and permissions

Three separate controls cover this area: OAuth permissions a user grants the service, visibility rules a user sets for viewers, and licenses the service issues to developers. A fourth item, the usage license a user declares on each image, tells developers what they may do with it. This section is a product design. Legal questions go to a lawyer, who also needs to review the terms of service.

| Who | Controls | Mechanism | Enforced by |
| --- | --- | --- | --- |
| User to service | What the service may read and write in the user's repo | atproto OAuth scopes | The user's PDS |
| User to viewers | Who can fetch the avatar and profile through the service | Visibility rules | The service |
| Developer to service | What a key may do and how much | License key with entitlements | The service |
| User to developers | What a developer may do with an image | Declared image license | Terms of service |

### 10.1 User permissions to the service (OAuth)

Atproto OAuth uses [granular scopes](https://atproto.com/specs/permission) for `repo`, `blob`, `rpc`, `identity`, and `account`. The service requests only what it needs:

- `atproto` for sign-in.
- Write access to the three user-repo collections from section 5, bundled in one published permission set so the consent screen is short. Permission sets are [published as lexicon schemas and referenced with an `include:` prefix](https://atproto.com/guides/permission-sets).
- `blob:image/*`, requested separately because [blob permissions cannot be included in permission sets](https://atproto.com/guides/permission-requests).
- `account:email`, requested only during email linking (section 6), also outside permission sets.

**Scope strings (confirmed November 3, 2026).** The [permission spec](https://atproto.com/specs/permission) writes a repo scope as `repo:` followed by a collection NSID, with an optional `action` parameter; omitting `action` allows all operations. So `repo:com.blueyvatar.image`, `repo:com.blueyvatar.profile`, and `repo:com.blueyvatar.claim` are the correct forms, and `repo:com.blueyvatar.image?action=create&action=update&action=delete` would narrow one of them. Partial wildcards such as `com.blueyvatar.*` are not supported. The spec gives `*/*` and `text/*` as blob glob examples, and the [permission requests guide](https://atproto.com/guides/permission-requests) shows `blob:image/*` for images only, so that form is correct. The account email scope is `account:email`; its `action` defaults to `read`, and `account:email?action=manage` is the form for managing the address. Blob and account permissions cannot go in permission sets.

Third-party apps that let users change their avatar request the same scopes, so one grant model covers the service and its integrators.

### 10.2 User visibility rules (who can fetch)

| Rule | Behavior | Default |
| --- | --- | --- |
| Public | Anyone can fetch the avatar and profile | Yes |
| Keyed only | Only requests with a valid license key | No |
| Domain allowlist | Only requests whose Origin or Referer match listed domains | No |
| Hidden profile | Profile page and JSON return 404; avatar still served by hash or handle | No |

**Important limit.** Rules apply to what this service serves. [All data in a user repo is public today](https://atproto.com/blog/atproto-spaces-alpha), so an avatar blob in the repo stays readable from the user's PDS regardless of these rules. Users who need real access control have two options:

1. **Service-stored avatar.** The image lives in the service's storage, outside the repo. Access control is real, and portability is lost.
2. **Atproto spaces.** Spaces store [non-public data with access control](https://atproto.com/blog/atproto-spaces-alpha), and the same post says that data is unencrypted. The alpha opened on August 20, 2026, the post says not to run production code against it, and the authors target a launch later this year. Treat spaces as a later phase.

The sign-up screen must state this limit in plain words.

### 10.3 Developer licenses

A license is a service-side record. Key design follows [Unavatar's model](https://github.com/microlinkhq/unavatar):

- **Secret keys** (`sk_`) for server use, sent in an `x-api-key` header. They can fetch avatars and manage keys, usage, and billing.
- **Publishable keys** (`pk_`) for browsers, passed as a `token` parameter so they work in an image tag. They can only fetch avatars.
- **Domain restrictions** on publishable keys: exact domains, wildcard subdomains, and `localhost` added explicitly.
- **Anonymous requests** work without a key at a low daily limit per IP address.

Each license holds these fields:

| Field | Purpose |
| --- | --- |
| `license_id`, `owner` | Owner is a DID or an organization account |
| `tier` | Free, Pro, Business, or Enterprise (section 11) |
| `entitlements` | Limits and feature flags copied from the tier at issue time |
| `keys` | Secret and publishable keys with labels and domain lists |
| `term`, `status` | Monthly or annual term; active, past due, suspended, canceled |
| `usage` | Metered counters (section 12) |
| `attribution` | Whether an attribution link is required |

Unavatar requires an [attribution link on its free plan and removes the requirement on paid plans](https://github.com/microlinkhq/unavatar). The same rule is proposed here for the Free tier.

### 10.4 Image license declaration

Each image record carries a `license` value the user picks. The values in section 5 are placeholders until the legal review. Two layers apply:

- **License to the service.** By signing in, the user grants the service a limited right to cache, resize, convert, and deliver the image through its CDN. Terms of service must say so.
- **License to developers.** A developer license allows showing the avatar next to the user's name in the developer's product. Other uses, such as advertising or resale, follow the user's declared license, and the profile JSON returns that field so integrators can check it.

## 11. Service tiers

The proposal has four developer tiers and two user plans, with privacy and safety controls free in every plan. Every number below is a proposed placeholder to validate with cost modeling. No published data exists for what this product costs to run, and prices are left open.

### 11.1 Developer tiers

| Capability | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Price | $0 | TBD per month | TBD per month | Contract |
| Intended for | Individuals, side projects | Indie developers, small sites | Companies, SaaS products | Platforms, white-label |
| Lookup by email hash, handle, DID | Yes | Yes | Yes | Yes |
| Anonymous requests | 100 per day per IP | 100 per day per IP | 100 per day per IP | Custom |
| Keyed requests | 1,000 per day | 50,000 per month | 1,000,000 per month | Custom |
| Overage | Blocked | Metered | Metered | Contract |
| API keys | 1 publishable | 5 | 25 | Unlimited |
| Domain restrictions on keys | No | Yes | Yes | Yes |
| Attribution link required | Yes | No | No | No |
| Max size (`s`) | 512 | 1024 | 2048 | 2048 |
| Output format and quality | PNG only | PNG, JPEG, WebP | PNG, JPEG, WebP | PNG, JPEG, WebP |
| Cache TTL (`ttl`) | Fixed 24h | 1h to 28d | 1h to 28d | 1h to 28d |
| Custom default image URL | No | Yes | Yes | Yes |
| Profile JSON | Basic, 4 verified accounts | Full | Full | Full |
| Hovercards and QR codes | No | No | Yes | Yes |
| Usage dashboard and API | No | 30 days | 12 months | Custom |
| Delivery from your own domain or node | No | No | No | Yes |
| Support | Community | Email | Priority email | Dedicated channel |

The row "Delivery from your own domain or node" is the Enterprise path to a federated node, in the style of [Libravatar's DNS-based delegation](https://wiki.libravatar.org/api/).

### 11.2 User plans

| Capability | Free | Plus |
| --- | --- | --- |
| Avatar images | 3 | 20 |
| Profile fields and links | Full | Full |
| Verified accounts | Up to 4 | Up to 20 |
| Gallery images | No | Yes |
| Custom profile domain | No | Yes |
| Profile view statistics | No | Yes |
| Visibility rules, ratings, reporting, deletion | Yes | Yes |

Gravatar [charges for custom domains and custom email addresses](https://listicler.com/tools/gravatar) while keeping avatars free, which supports putting a custom domain in Plus.

### 11.3 Reference points from competitors

- Unavatar: [25 anonymous requests per day per IP, 50 included origin requests per day with a key, and $0.010 per token afterward](https://github.com/microlinkhq/unavatar).
- Gravatar: free avatars and profiles, with paid custom domains and an [enterprise tier that adds a private Slack channel, integration help, and early access](https://listicler.com/tools/gravatar).
- Libravatar and atp.pics: free.

## 12. Billing and metering

Every avatar request passes one entitlement check before it is served, and only requests that reach the origin are metered. Unavatar [counts cache misses against a plan and serves cache hits free](https://github.com/microlinkhq/unavatar), and this spec proposes the same rule. Counting every request instead would raise revenue but would charge developers for traffic the CDN absorbs.

**Cost basis (unsourced inference).** Unavatar's origin requests are expensive because many providers need page scraping and proxies, and it bills by [resolution tier: origin, datacenter proxy, or residential proxy](https://unavatar.io/docs). An atproto resolution reads a public record and blob from a PDS, with no scraping or proxy, so the per-miss cost should be lower. That supports an overage rate below Unavatar's $0.010 per token, to be validated with measured costs before prices are published. Cache warming by the indexer (section 4) is a service cost and does not count against a license's included volume.

**Cloudflare free plan and metering.** Cloudflare caches the resized images, so image hits never reach the service and are not metered. The redirect routes have no file extension and are [not cached by default](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/), so each avatar view reaches the service once, and the usage numbers in section 11 assume that. With the v6 redirect caching proposal (section 7), a browser that already holds a redirect skips the service until its ttl ends, so the count is closer to one origin request per browser per ttl. Keys and limits are checked on every request that reaches the service. A Cloudflare cache rule on the avatar routes would cut that load further, but a cached response would skip the key check until it expires. The Free plan [allows 10 cache rules](https://developers.cloudflare.com/cache/how-to/cache-rules/), and the redirects' `private` header keeps them out of the CDN cache in v6 (section 13).

**Request pipeline**

1. Read the key from the `x-api-key` header or the `token` parameter. No key means an anonymous request.
2. Load the license and confirm its status is active.
3. For publishable keys, check the Origin or Referer against the key's domain list.
4. Check the rate window for the key or, for anonymous requests, the IP address.
5. Apply entitlements: clamp `s` to the tier cap, reject formats the tier does not include, and ignore gated parameters.
6. Apply the target user's visibility rules (section 10.2).
7. Resolve and deliver the image.
8. On an origin resolution, add to the license's usage counters.

**Meters**

| Meter | Counted when | Used for |
| --- | --- | --- |
| Origin resolutions | A request reaches the service, including the redirect for each avatar view | Included volume and overage billing |
| Transforms | A new size, format, or quality variant is generated | Cost tracking; may be bundled |
| Profile JSON calls | Every call | Rate limits |
| Bytes delivered | CDN reports per license | Cost tracking and abuse detection |

Keyed responses carry rate-limit headers like Unavatar's and a usage cost header, so developers can track consumption without calling a separate API.

**Billing rules**

- Plans bill monthly or annually. Overage on Pro and Business is metered at a published per-unit rate (to be set).
- A past-due license gets a grace period, then drops to Free limits. A downgrade changes limits only and never deletes user data, user avatars, or profiles.
- Free-tier attribution is checked on the developer's production site. Unavatar requires the link to be [public, followable, and on a production site](https://github.com/microlinkhq/unavatar), and reserves the right to revoke free access when it is missing.
- Keys can be rotated and revoked at any time, with usage alerts at 80 and 100 percent of included volume.
- The payment processor, tax handling, and invoicing are not chosen and are listed in section 13.

## 13. Open questions and risks

Thirteen items in the table below need a decision or an answer before build, and three of the five Cloudflare and image items after it still have open parts. Where no published answer exists, the status says so, and I can offer a reasoned guess on request.

| # | Question or risk | Why it matters | Status |
| --- | --- | --- | --- |
| 1 | Can the service trust `emailConfirmed` from any PDS? | A self-hosted PDS can return any address, which would let someone claim another person's email hash | No published answer found on how non-Bluesky hosts verify email. The code fallback in section 6 is the working assumption |
| 2 | Support MD5 hashes? | Older Gravatar integrations send MD5. [Libravatar](https://wiki.libravatar.org/api/) and [Unavatar](https://github.com/microlinkhq/unavatar) accept it, but MD5 is weaker | Decision needed |
| 3 | Which verification method for each outside account? | Verified accounts depend on it | Gravatar's methods are not documented in the pages I read |
| 4 | Which Gravatar details are missing? | Multiple emails per account, upload limits, cropping, abuse flow | Not confirmed in sources; can be pulled from Gravatar support docs |
| 5 | Two DIDs claim the same email hash | Wrong owner would receive the avatar | Policy needed, for example both must pass a mailed code and the newest verification wins |
| 6 | Hash lookups reveal whether an email has a linked account | Anyone can test a list of known addresses | Mitigate with rate limits and a user opt-out of email lookup |
| 7 | Honor the `!no-unauthenticated` self-label? | It could serve as a privacy signal | Semantics confirmed: the atproto labels guide says it [makes the content inaccessible to logged-out users in applications which respect the label](https://atproto.com/guides/labels), lists it as a global value usable as a self-label, and leaves enforcement to applications. The [label spec](https://atproto.com/specs/label) does not mention it. Decision needed: avatar requests carry no viewer session, so honoring it would mean refusing delivery for that account (my inference) |
| 8 | Atproto spaces timing | Real access control for avatars depends on it | [Alpha since August 20, 2026, not for production, launch targeted later this year](https://atproto.com/blog/atproto-spaces-alpha) |
| 9 | Name clearance for blueyvatar and blueyvatar.com | Lexicon IDs are hard to change once other apps depend on them | Name chosen. Clear it and confirm the domain before publishing lexicons (see the note below this table). Also consider proposing the profile lexicon to community standards efforts, since the atp.pics author [wants one](https://graham.leaflet.pub/3mhr36lsmo222) |
| 10 | Legal review | Terms of service, privacy policy, image licenses, treatment of hashed emails | Needs a lawyer; I am not one |
| 11 | Payment processor, taxes, invoicing, pricing | Section 12 depends on them | Not chosen; no cost data available |
| 12 | `/img` bypasses tier size caps | `/img` URLs carry no key and accept any size up to 2048 (section 7), so a Free caller can build a 2048 URL and skip the 512 cap in section 11 | Open risk. Mitigation ideas: sign image paths at the redirect route, or restrict `/img` to a fixed size ladder so tier caps map to a few cacheable sizes |
| 13 | Which Tangled collection to read | A [Tangled core commit dated November 2, 2026](https://tangled.org/tangled.org/core/commit/02d9ff54fcdb96ae5665feb794aa14ba24302a79) removed the `sh.tangled.*` lexicons, and the main branch now defines [`org.tangled.actor.profile`](https://tangled.org/tangled.org/core/blob/master/lexicons/org/tangled/actor/profile.json). Both use an `avatar` blob field | No published answer found on whether existing user records were migrated. Proposal: one adapter per collection, `org.tangled.actor.profile` first |

**Name clearance for blueyvatar.** One search found no existing product with this name, which does not prove it is free. Two checks are needed before launch. First, Bluesky's [trademark policy](https://bsky.social/about/support/trademarks) prohibits using Bluesky, bsky, or any confusingly similar variation in a domain name or a product name without written authorization. Whether blueyvatar counts is a legal judgment, and trademarks@blueskyweb.xyz is the contact for permission questions. Second, Bluey is the name of a well-known children's series [produced by Ludo Studio for the ABC and BBC Studios](https://whatsondisneyplus.com/bluey-profile-avatars-added-to-disney/), so a clearance search for Bluey-based names is prudent. I have not checked whether blueyvatar.com is available to register. The [atproto trademark policy](https://atproto.com/about/trademarks/atproto-trademark-policy) covers the atproto marks separately and does not restrict ordinary use of domain names as NSIDs.

**Cloudflare and image items (researched November 3, 2026).**

1. **Free plan cache rules for extensionless routes. Answered.** [Cache Rules are available on every plan, with 10 rules on Free](https://developers.cloudflare.com/cache/how-to/cache-rules/) (25 Pro, 50 Business, 300 Enterprise). The [settings page](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/) offers an "Eligible for cache" setting with no plan restriction stated, and it says nothing specific about extensionless paths. Custom cache keys built from a header, cookie, or query string are listed for Enterprise only, so on Free a cached redirect could not vary by API key and would skip the key check until it expires. v6 sends the redirects as `private` (section 7), which keeps them out of the CDN cache with no rule needed.
2. **Visitor IP behind Cloudflare. Answered.** Cloudflare's [HTTP headers reference](https://developers.cloudflare.com/fundamentals/reference/http-headers/) says `CF-Connecting-IP` provides the client IP address connecting to Cloudflare to the origin, holds a single address, and is sent only on traffic from Cloudflare's edge to the origin. `X-Forwarded-For` may also list proxy addresses, and `True-Client-IP` is Enterprise only. Anonymous limits key on `CF-Connecting-IP`. Proposal: trust it only on requests that arrive through Cloudflare, since a request sent straight to the origin can carry any header value.
3. Whether the Free plan fits a paid service. Cloudflare describes it as [best suited for personal projects](https://www.cloudflare.com/lp/pg-all-plans-multi-sku-simple/), so the plan may need to change once customers depend on the service. Still open.
4. **Image library. Decided (design decision taken in the scaffold).** The scaffold uses [sharp](https://www.npmjs.com/package/sharp) 0.35.5 in a forked child process with a 256 MiB heap cap and a 10 second timeout ([resize.ts](../../apps/delivery/src/resize.ts), section 14). Sharp's [constructor options](https://sharp.pixelplumbing.com/api-constructor) document `limitInputPixels` (default 268,402,689 pixels, "0x3FFF x 0x3FFF", which trusts the dimensions in the input metadata) and `failOn` (default `warning`, and the docs say to "use the default 'warning' level with untrusted input"). The scaffold's [resize worker](../../apps/delivery/src/resize-worker.ts) sets `limitInputPixels` to 40,000,000 and `failOn` to `warning`, following sharp's advice. Whether originals need a bucket if a user's PDS is slow or down is still open.
5. Whether the Keyed only and Domain allowlist rules (section 10.2) can cover image URLs that the CDN caches. In this design they cover the redirect route alone. Still open, and related to item 12.

## 14. Technology choices

The build uses TypeScript, with Fly.io hosting everything we run and Neon hosting Postgres and the Cloudflare free plan in front for DNS, caching, DDoS protection, and TLS. [atproto.com](https://atproto.com) and its specs are the authoritative source for protocol behavior in this spec and govern wherever sources disagree. Package READMEs, third-party blogs, and competitor docs are secondary.

| Layer | Choice | Confirmed in the authoritative docs? | Notes |
| --- | --- | --- | --- |
| Language | TypeScript | Yes. It is a [reference SDK](https://atproto.com/sdks), with Go the other | Go is not used |
| Lexicon types and client | `@atproto/lex`, using `lex install`, `lex build`, and its `Client` | Yes. The [lexicon install guide](https://atproto.com/guides/installing-lexicons) and tutorials use it | Version [0.4.4](https://www.npmjs.com/package/@atproto/lex) when checked on November 3, 2026. It is pre-1.0, so pin versions. Bluesky's repo guidance says new service code should [prefer it over the older `@atproto/api` stack](https://github.com/bluesky-social/atproto/blob/main/AGENTS.md) |
| OAuth | `@atproto/oauth-client-node` as a confidential client | Yes. It is [suited to server-side deployments](https://atproto.com/guides/oauth), and the [BFF pattern is the recommended route to a confidential client](https://atproto.com/guides/oauth) | Version [0.5.13](https://www.npmjs.com/package/@atproto/oauth-client-node) when checked on November 3, 2026, so pin it |
| Web app | Next.js backend-for-frontend on Fly.io | Yes. atproto.com has a [Next.js OAuth tutorial and a cookbook example](https://atproto.com/guides/about-oauth) | Holds the signing key and sessions |
| Identity resolution | `@atproto/identity` | Partly. The [OAuth tutorial](https://atproto.com/guides/oauth-cli-tutorial) shows handle resolution inside the OAuth client. The package itself is documented in its own README | Resolves a handle to a DID, resolves the DID document, and lets you check that the document names the same handle. Version [0.5.20](https://www.npmjs.com/package/@atproto/identity) when checked on November 3, 2026 |
| Sync | Tap with the `@atproto/tap` client, on Fly.io | Partly. The [backfilling guide](https://atproto.com/guides/backfilling) presents Tap. The TypeScript client is documented in its own README | The client adds repos to track, delivers backfill before live events, keeps events in order per repo, and acknowledges an event after your handler succeeds. Tap is in beta. Jetstream is the documented [fallback](https://atproto.com/guides/streaming-data). `@atproto/tap` version [0.4.17](https://www.npmjs.com/package/@atproto/tap) when checked on November 3, 2026 |
| Delivery API | TypeScript HTTP service on Fly.io, separate from the web app | Not applicable | Design choice |
| Image resizing | [sharp](https://www.npmjs.com/package/sharp) 0.35.5 in a forked child process on Fly.io, with a heap cap (`--max-old-space-size`, 256 MiB) and a hard timeout (10 seconds, then the process is killed). The CDN caches results, and nothing is stored | Not applicable | Design decision taken in the [scaffold](../../apps/delivery/src/resize.ts). Sharp's [`limitInputPixels` and `failOn` options](https://sharp.pixelplumbing.com/api-constructor) bound input size and reject invalid pixel data; sharp advises `failOn: 'warning'` for untrusted input (section 13). Node documents the heap flag as setting [the max size of V8's old memory section](https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-mib), so memory used outside V8 relies on the pixel limit and the timeout (my inference) |
| Edge and DNS | Cloudflare free plan in front of blueyvatar.com for DNS, CDN cache, DDoS protection, and TLS | Partly. Cloudflare says [every plan includes DNS, a CDN, and DDoS protection](https://www.cloudflare.com/lp/pg-all-plans-multi-sku-simple/). Caching rules follow its [default cache behavior page](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/) | Caches by file extension and respects origin Cache-Control. See section 14.1 |
| Hosting | Fly.io for the web app, delivery API, indexer, and Tap | Partly. The atproto [self-hosting guide](https://atproto.com/guides/self-hosting) links a Tap quick start for another host | No source ranks hosts |
| Database | Postgres on Neon | Not applicable | Tap supports Postgres, and the Neon connector is available |

**Rules taken from atproto.com**

1. **Proxy blobs.** Applications [must serve blobs through an independent CDN or proxy, never straight from the PDS](https://atproto.com/specs/blob). The delivery API only redirects to its own cached copies.
2. **Sandbox image processing.** The same spec strongly recommends against parsing media files without strong sandboxing, so resizing and conversion run in an isolated, resource-limited worker.
3. **OAuth metadata.** The `client_id` is a [URL that serves the client metadata](https://atproto.com/guides/oauth). A confidential client has a [secret key bound to that client ID](https://atproto.com/guides/oauth), stored in Infisical. The proposed client ID is https://blueyvatar.com/oauth-client-metadata.json.
4. **Version pinning.** `@atproto/lex` and the Node OAuth client are pre-1.0, and Tap is in beta. Pin exact versions and review changelogs before upgrading.

**Package checks (November 3, 2026).** `@atproto/identity` and `@atproto/tap` are documented only in their own READMEs; the atproto.com pages I read do not cover them. Both match what this spec needs. Custom lexicon types are now covered: the [`@atproto/lex` 0.4.4 README](https://www.npmjs.com/package/@atproto/lex) documents `lex build --lexicons <dir> --out <dir>` for a local lexicons directory, with `./lexicons` and `./src/lexicons` as the defaults. The repo's [`lex:build` script](../../package.json) runs it on the service lexicons in `lexicons/com/blueyvatar/`. Phase 1 should start by generating types for the three service records in section 5.

### 14.1 Cloudflare free plan

Cloudflare sits in front of blueyvatar.com on its free plan and does nothing else. Workers, R2, Images, Hyperdrive, and KV are parked because each adds a service to run and a bill to track.

**What we use**

- DNS, a CDN, and DDoS protection. Cloudflare says [every plan includes them](https://www.cloudflare.com/lp/pg-all-plans-multi-sku-simple/), and it calls the Free plan best suited for personal projects.
- Caching by [file extension](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/). HTML and JSON are not cached by default. Cloudflare caches a response marked public with a max-age above zero, and skips one marked private, no-store, no-cache, or max-age=0, one that sets a cookie, and any non-GET request. The default list includes AVIF, JPEG, PNG, and WEBP, and the Free plan limit is 512 MB per file.
- A cache lock. When many requests for an uncached file reach one data center together, Cloudflare sends the origin a single request, which limits duplicate resizes.

**Rules this creates**

1. Resized images use paths that end in `.png`, `.jpeg`, `.webp`, or `.avif`, with `Cache-Control: public, max-age=31536000, immutable`.
2. Image responses never set cookies.
3. The avatar and profile routes have no extension, so Cloudflare passes them to the service each time. The redirects also send `Cache-Control: private, max-age=<ttl>`, so Cloudflare never caches them and the browser keeps each one for the ttl (section 7).
4. Image URLs contain no key. Keys, limits, and visibility rules apply at the redirect route, and anyone holding an image URL can fetch it. That fits public avatars, and it lets a caller request any size up to 2048 (section 13, item 12).
5. Anonymous rate limits read the visitor IP from `CF-Connecting-IP` (section 13).

**Parked options.** Each has a free allowance, listed in the Cloudflare pages in the sources: [R2](https://developers.cloudflare.com/r2/pricing/) storage with no egress charges, [Images](https://developers.cloudflare.com/images/pricing/) transformations, and [Workers](https://developers.cloudflare.com/workers/platform/pricing/). The paid parts add bills and moving parts, so they stay out of v1.

## 15. Sources

As of November 3, 2026. The pages under "Opened in full" and "Opened for v6", plus the atproto.com SDKs page, were opened directly; the rest were read as search excerpts, so check them before relying on a figure.

**Authoritative source: [atproto.com](https://atproto.com).** Protocol behavior in this spec follows atproto.com and its specs. Every other source is secondary and yields to atproto.com on a conflict. atproto.com pages used: [SDKs](https://atproto.com/sdks), [OAuth](https://atproto.com/guides/oauth), [About OAuth](https://atproto.com/guides/about-oauth), [OAuth CLI tutorial](https://atproto.com/guides/oauth-cli-tutorial), [Installing lexicons](https://atproto.com/guides/installing-lexicons), [Reads and writes](https://atproto.com/guides/reads-and-writes), [Images and video](https://atproto.com/guides/images-and-video), [Blob spec](https://atproto.com/specs/blob), [Backfilling](https://atproto.com/guides/backfilling), [Streaming data](https://atproto.com/guides/streaming-data), [Self-hosting](https://atproto.com/guides/self-hosting), [Going to production](https://atproto.com/guides/going-to-production), and the permission pages listed below.

**Cloudflare facts** follow Cloudflare's own pages, read as search excerpts in November 2026: the [plans overview](https://www.cloudflare.com/lp/pg-all-plans-multi-sku-simple/) and [default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/) for what the spec uses, and [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Images pricing](https://developers.cloudflare.com/images/pricing/), and [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) for the parked options. Prices and limits change, so recheck them before launch.

**Opened in full**

- [Libravatar Simple API](https://wiki.libravatar.org/api/)
- [Unavatar README](https://github.com/microlinkhq/unavatar)
- [The Atproto Spaces Alpha is Live](https://atproto.com/blog/atproto-spaces-alpha)

**Opened for v6 (November 3, 2026)**

- npm package pages, checked for latest versions: [@atproto/oauth-client-node](https://www.npmjs.com/package/@atproto/oauth-client-node) 0.5.13, [@atproto/identity](https://www.npmjs.com/package/@atproto/identity) 0.5.20, [@atproto/lex](https://www.npmjs.com/package/@atproto/lex) 0.4.4 (including its README on `lex build`), [@atproto/tap](https://www.npmjs.com/package/@atproto/tap) 0.4.17, and [sharp](https://www.npmjs.com/package/sharp) 0.35.5
- [sharp constructor options](https://sharp.pixelplumbing.com/api-constructor) for `limitInputPixels` and `failOn`
- [Node.js command-line options](https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-mib) for `--max-old-space-size`
- Cloudflare [HTTP headers reference](https://developers.cloudflare.com/fundamentals/reference/http-headers/), [Cache Rules](https://developers.cloudflare.com/cache/how-to/cache-rules/), and [Cache Rules settings](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/)
- Atproto [permission spec](https://atproto.com/specs/permission), [permission requests guide](https://atproto.com/guides/permission-requests), [labels guide](https://atproto.com/guides/labels), and [label spec](https://atproto.com/specs/label)
- Tangled core repo: the [`sh.tangled.actor.profile` lexicon before removal](https://tangled.org/tangled.org/core/blob/02d9ff54fcdb96ae5665feb794aa14ba24302a79~1/lexicons/actor/profile.json), the [commit that removed it](https://tangled.org/tangled.org/core/commit/02d9ff54fcdb96ae5665feb794aa14ba24302a79), and the current [`org.tangled.actor.profile` lexicon](https://tangled.org/tangled.org/core/blob/master/lexicons/org/tangled/actor/profile.json)
- This repository's scaffold: [package.json](../../package.json), [resize.ts](../../apps/delivery/src/resize.ts), and [resize-worker.ts](../../apps/delivery/src/resize-worker.ts)

**Read as search excerpts**

- [Gravatar image API](https://docs.gravatar.com/api/images/), [data models](https://docs.gravatar.com/rest/api-data-specifications/data-models), [REST API](https://docs.gravatar.com/rest-api), and [developer guide](https://docs.gravatar.com/guides/llms-txt/)
- [Gravatar profile features overview](https://www.sqlservercentral.com/blogs/beyond-avatars-how-gravatar-is-transforming-online-identity) and [Gravatar Enhanced plugin changelog](https://fao.wordpress.org/plugins/?p=12258)
- [Gravatar listing with pricing notes](https://listicler.com/tools/gravatar)
- [atp.pics announcement](https://graham.leaflet.pub/3mhr36lsmo222), [README](https://tangled.org/graham.systems/atp.pics/raw/optimize-resolution/README.md), and [fetch code](https://tangled.org/graham.systems/atp.pics/blob/optimize-resolution/internal/fetch/fetch.go)
- [Unavatar general availability post](https://microlink.io/blog/unavatar-generally-available)
- [Bluesky profile lexicon](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/actor/profile.json)
- Atproto [permission sets guide](https://atproto.com/guides/permission-sets) (the permission spec and permission requests guide were opened for v6, above)
- [PDS getSession source](https://cdn.jsdelivr.net/npm/@atproto/pds@0.4.218/src/api/com/atproto/server/getSession.ts)
- [Bluesky moderation guide](https://docs.bsky.app/docs/advanced-guides/moderation)

Also read for the cache-warming and cost-basis notes: [Microlink rendered HTML API](https://microlink.io/html) and [Unavatar docs](https://unavatar.io/docs).

Also read for the adapter design in section 7: [DeepWiki overview of Unavatar](https://deepwiki.com/microlinkhq/unavatar), an AI-generated summary of an older commit, so treat it as indicative.

**Not sourced.** Tier limits, rating-to-label mapping, the lexicon draft, the resolution order, the redirect caching ttl, the CID check, and the `/img` mitigation ideas are design proposals by this spec, with no published source behind them.
