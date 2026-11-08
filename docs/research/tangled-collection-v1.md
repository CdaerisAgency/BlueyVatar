# Which Tangled collection to read (v1)

Checked: November 7, 2026. Scope: issues #69 and #55, spec sections 7 and 13 (item 13) of `docs/spec/blueyvatar-product-spec-v11.md`, and `packages/core/src/adapters.ts`. Everything below was measured from live repos on that date, except where marked **not done**.

## Question

Which collection holds users' existing Tangled profiles, `org.tangled.actor.profile` or the legacy `sh.tangled.actor.profile`, and what does reading both cost per cache miss?

## Decision

1. **Enable `org.tangled.actor.profile`** (adapter `tangled`, priority 2).
2. **Enable `sh.tangled.actor.profile`** (adapter `tangled-legacy`, priority 3) as a **fallback that is read only when the new collection has no record** for the account. Unmigrated users still exist: the relay index lists 14,079 repos with only the legacy record, and 20 of 22 randomly sampled legacy-only repos still held a legacy profile record (4 of those carried an avatar).
3. If the new record exists but has no avatar, the legacy record is **not** consulted. In the sample, no account had an avatar in the legacy record while having a new record without one, so this rule loses nothing seen so far and saves a read.
4. Both adapters keep the same `avatarPath` (`avatar`), `labelsPath` (`labels`), and accept list (PNG, JPEG). The fallback is expressed as configuration (`fallbackFor: 'tangled'`) so it stays an adapter setting, as spec section 7 describes.

Asking Tangled maintainers whether records were migrated (issue #69, second checkbox) is **not done**. The live data answers the practical question, and the maintainers' plan for the remaining legacy records is still unknown.

## Method

1. **Population counts.** I paged `com.atproto.sync.listReposByCollection` on `relay1.us-east.bsky.network` for both collections. The relay lists every repo it has seen with at least one record in the collection.
2. **Sample.** A seeded random draw (mulberry32, seed 20261107) of 22 repos from the new collection's list (stratum A) and 22 from the repos that the relay lists only under the legacy collection (stratum B), 44 accounts in total. The strata are not proportional to the population, so the in-sample percentages below describe the sample only. Population claims use the relay counts.
3. **Per account.** Resolve the DID (plc.directory for `did:plc`, `/.well-known/did.json` for `did:web`; all 44 were `did:plc`), read the `#atproto_pds` endpoint, call `com.atproto.repo.listRecords` for both collections on that PDS, then call `com.atproto.repo.getRecord` with rkey `self` for both collections and time each call.
4. **Transport.** Outbound HTTPS through the agent proxy with TLS verification on. Requests ran one at a time from one container.

## Population (relay index, November 7, 2026)

| Measure | Repos |
| --- | --- |
| Has `org.tangled.actor.profile` | 3,000 |
| Has `sh.tangled.actor.profile` | 16,056 |
| Has both | 1,977 |
| Only the new collection | 1,023 |
| Only the legacy collection | 14,079 |

The relay index can lag the PDS: 3 of the 44 sampled repos had no record in either collection when read from the PDS (one was a stale entry, two returned a repo lookup error or HTTP 5xx on the list call).

## Sample results (44 accounts)

| Finding | Count |
| --- | --- |
| Stratum A (listed under the new collection), 22 accounts | 21 have a new record; 13 of those have an avatar; 14 also have a legacy record (6 with an avatar) |
| Stratum B (listed only under the legacy collection), 22 accounts | 0 have a new record; 20 have a legacy record; 4 of those have an avatar |
| Accounts with both records | 14 |
| Avatar blob shape | All 23 avatars seen (13 new, 10 legacy) are typed blobs shaped `{ $type: "blob", ref: { $link }, size, mimeType }`, which `readBlobRef` already reads |
| MIME types | `image/png` and `image/jpeg` only |
| Record key | `self` for every record |
| Both records, same avatar | In the 14 accounts with both records, 6 have the same avatar CID in both, 4 have an avatar only in the new record, and 4 have no avatar in either. None differ, and none have an avatar only in the legacy record |
| Avatar over 1,000,000 bytes | 1 legacy avatar (2,533,667 bytes). The adapter does not enforce the lexicon size limit, so this one is read as is |

Record shapes seen: the new record carries `$type`, `avatar`, `createdAt`, plus optional `pronouns`, `description`, `links`, `stats`, `location`, `pinnedRepositories`, `isOrganization`. The legacy record carries `$type`, `avatar`, `bluesky`, `links`, `stats`, `location`, `pronouns`, `description`, `preferredHandle`, `pinnedRepositories`. Neither sample record had a `labels` field. A new record can be only `{ "$type": "org.tangled.actor.profile" }`, which means a profile with no avatar.

### Per-account table

Stratum A is listed under the new collection, B only under the legacy collection. Avatar cells show MIME type and bytes. The last two columns are `getRecord` time in milliseconds with the HTTP status in parentheses (400 is RecordNotFound; 500 is an upstream error). DIDs are shortened.

| # | Stratum | DID | PDS host | `org.tangled.actor.profile` | `sh.tangled.actor.profile` | getRecord org (ms) | getRecord sh (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | A | `did:plc:joetykgy...` | tngl.sh | record, no avatar | no record | 120 (200) | 120 (400) |
| 2 | A | `did:plc:lh6pwykj...` | tngl.sh | blob jpeg 44622 | blob jpeg 44622 | 121 (200) | 120 (200) |
| 3 | A | `did:plc:3txwypzi...` | bsky host | blob png 202766 | blob png 202766 | 82 (200) | 74 (200) |
| 4 | A | `did:plc:mye5bv54...` | tngl.sh | record, no avatar | record, no avatar | 119 (200) | 119 (200) |
| 5 | A | `did:plc:2rts6ksd...` | tngl.sh | blob png 39045 | no record | 118 (200) | 119 (400) |
| 6 | A | `did:plc:jps5v54e...` | tngl.sh | record, no avatar | no record | 119 (200) | 124 (400) |
| 7 | A | `did:plc:7gilsvvm...` | bsky host | blob jpeg 10897 | record, no avatar | 72 (200) | 70 (200) |
| 8 | A | `did:plc:bej2ilqw...` | tngl.sh | record, no avatar | record, no avatar | 119 (200) | 119 (200) |
| 9 | A | `did:plc:fneqyvm4...` | tngl.sh | blob png 194386 | blob png 194386 | 119 (200) | 120 (200) |
| 10 | A | `did:plc:vhwsdz6p...` | bsky host | blob png 403561 | blob png 403561 | 41 (200) | 38 (200) |
| 11 | A | `did:plc:shyznj72...` | tngl.sh | blob jpeg 10909 | blob jpeg 10909 | 120 (200) | 124 (200) |
| 12 | A | `did:plc:caapew7y...` | tngl.sh | blob png 99999 | no record | 121 (200) | 129 (400) |
| 13 | A | `did:plc:hic6geqp...` | tngl.sh | record, no avatar | record, no avatar | 125 (200) | 121 (200) |
| 14 | A | `did:plc:dwpwoizi...` | bsky host | no record | no record | 114 (400) | 113 (400) |
| 15 | A | `did:plc:xq27otqu...` | bsky host | blob jpeg 221281 | record, no avatar | 79 (200) | 73 (200) |
| 16 | A | `did:plc:bqhabx5y...` | bsky host | blob jpeg 104219 | record, no avatar | 38 (200) | 38 (200) |
| 17 | A | `did:plc:rbqsyfls...` | bsky host | blob png 70800 | no record | 40 (200) | 41 (400) |
| 18 | A | `did:plc:ign2srfq...` | self-hosted | blob png 853649 | record, no avatar | 46 (200) | 51 (200) |
| 19 | A | `did:plc:ev4gssjh...` | tngl.sh | record, no avatar | record, no avatar | 122 (200) | 154 (200) |
| 20 | A | `did:plc:wwpcqbb6...` | tngl.sh | record, no avatar | no record | 121 (200) | 122 (400) |
| 21 | A | `did:plc:6mytglxb...` | self-hosted | blob png 12374 | blob png 12374 | 124 (200) | 124 (200) |
| 22 | A | `did:plc:lgeayh75...` | tngl.sh | record, no avatar | no record | 119 (200) | 127 (400) |
| 23 | B | `did:plc:g7caa4il...` | bsky host | no record | record, no avatar | 38 (400) | 37 (200) |
| 24 | B | `did:plc:kgrm34ie...` | bsky host | no record | record, no avatar | 71 (400) | 77 (200) |
| 25 | B | `did:plc:a3to7f5a...` | tngl.sh | no record | record, no avatar | 119 (400) | 119 (200) |
| 26 | B | `did:plc:benehogq...` | tngl.sh | no record | blob jpeg 2533667 | 120 (400) | 123 (200) |
| 27 | B | `did:plc:mp5tjflb...` | bsky host | no record | record, no avatar | 76 (400) | 76 (200) |
| 28 | B | `did:plc:si57mnfp...` | tngl.sh | no record | record, no avatar | 131 (400) | 120 (200) |
| 29 | B | `did:plc:4ahko5bv...` | tngl.sh | no record | record, no avatar | 125 (400) | 123 (200) |
| 30 | B | `did:plc:z6ql5nxo...` | tngl.sh | no record | record, no avatar | 156 (400) | 280 (200) |
| 31 | B | `did:plc:snuedk4n...` | tngl.sh | no record | record, no avatar | 126 (400) | 139 (200) |
| 32 | B | `did:plc:4rwmxefa...` | tngl.sh | no record | blob jpeg 101822 | 123 (400) | 147 (200) |
| 33 | B | `did:plc:yswqeh3v...` | bsky host | no record | blob png 18520 | 74 (400) | 75 (200) |
| 34 | B | `did:plc:zb5haso7...` | tngl.sh | no record | record, no avatar | 120 (400) | 120 (200) |
| 35 | B | `did:plc:lllgm3bc...` | bsky host | no record | record, no avatar | 72 (400) | 78 (200) |
| 36 | B | `did:plc:7xwow4eh...` | bsky host | no record | record, no avatar | 77 (400) | 76 (200) |
| 37 | B | `did:plc:5xkbeoqs...` | bsky host | no record | record, no avatar | 39 (400) | 38 (200) |
| 38 | B | `did:plc:pvabpocf...` | bsky host | no record | blob jpeg 10835 | 39 (400) | 38 (200) |
| 39 | B | `did:plc:4pyrsvde...` | tngl.sh | no record | record, no avatar | 349 (400) | 1266 (200) |
| 40 | B | `did:plc:au47z4qx...` | tngl.sh | no record | no record | 812 (400) | 679 (200) |
| 41 | B | `did:plc:eqjqbmbd...` | tngl.sh | no record | record, no avatar | 1673 (400) | 1185 (200) |
| 42 | B | `did:plc:pbz6etvk...` | tngl.sh | no record | record, no avatar | 576 (500) | 116 (500) |
| 43 | B | `did:plc:snj6tlps...` | bsky host | no record | record, no avatar | 38 (400) | 38 (200) |
| 44 | B | `did:plc:utgeyhly...` | tngl.sh | no record | no record | 1647 (400) | 1119 (400) |

## Measured extra read cost

An extra read is one `com.atproto.repo.getRecord` call to the user's PDS. Delivery already makes one for `app.bsky.actor.profile`. **Indicative only: one container, one run, one call per account and collection, 44 accounts, 26 of them on the `tngl.sh` PDS.**

| Call | n | p50 | p95 |
| --- | --- | --- | --- |
| `getRecord` new collection, all statuses | 44 | 119 ms | 812 ms |
| `getRecord` new collection, record found (200) | 21 | 119 ms | 124 ms |
| `getRecord` new collection, record missing (400) | 22 | 119 ms | 1,647 ms |
| `getRecord` legacy collection, all statuses | 44 | 119 ms | 1,119 ms |
| `getRecord` legacy collection, record found (200) | 34 | 119 ms | 1,185 ms |

The p50 sits at about 119 ms because `tngl.sh` answered in 118 to 125 ms for most calls, while Bluesky-hosted PDS hosts answered in 38 to 82 ms. The p95 values come from a handful of slow calls on `tngl.sh` (up to 1.7 s), and two calls returned HTTP 500. With 44 accounts, a p95 is the third slowest call, so treat it as a rough ceiling.

What this means per cache miss with the decision above:

| Account type | Extra reads over today | Typical added latency at p50 |
| --- | --- | --- |
| Has a new Tangled record | 1 | about 0.1 s |
| Legacy record only (unmigrated) | 2 | about 0.2 s |
| No Tangled record (most Bluesky users) | 2 | about 0.2 s |

Delivery runs adapters one after another, so the two reads add up. Skipping the legacy read when the new record exists saves one read for every migrated user. For an account with no Tangled record, both reads return 400 and the two extra reads are the cost of supporting Tangled. Because image URLs are immutable and cached by the CDN, this cost applies to cache misses only. Reading the two Tangled collections in parallel, or a negative cache for accounts with no Tangled record, would cut it further. Neither is part of this change. Both were added afterward, see the next section.

## Follow-up changes (issue #132)

- **Parallel reads.** Delivery starts the Bluesky-independent adapter reads together and decides in priority order. The legacy record is still used only when the new collection has no record, but its read now starts at the same time, so a migrated user costs one extra read (in parallel) where it used to cost none. A cache miss now waits for the slowest read, not the sum.
- **Negative cache.** A "no record" answer is remembered per DID and collection for 10 minutes (`NO_RECORD_TTL_MS`), up to 10,000 entries. Errors are never cached. The Bluesky profile is not cached this way because its labels hide the whole account. Delivery and the indexer are separate processes with no channel between them, so there is no invalidation: a new Tangled record can take up to 10 minutes to appear after a miss was cached.
- **Avatar size limit.** `maxAvatarBytes` on the Tangled adapters is 1,000,000. A blob whose record declares a larger size is treated as no avatar and logged as `adapter avatar over size limit`. A record that declares no size passes this check.
- **Indexer.** `org.tangled.actor.profile` and `sh.tangled.actor.profile` are now in the indexer handlers and in `TAP_COLLECTION_FILTERS` (now seven collections). A change purges the DID's cached images and the new avatar, then warms them, the same as a Bluesky profile change. Tap must be redeployed with the new filter list.

Risk 5 below is resolved by the indexer change. Risk 6 is resolved by the size limit.

## Risks and follow-ups

1. **Moving target.** Records are migrating now (1,977 repos have both). The legacy fallback can be turned off with `enabled: false` once the legacy-only count is small. Recount with `listReposByCollection` then.
2. **Relay index lag.** The counts come from a relay index, not a PDS scan. The sample suggests a few percent of entries are stale or unreachable.
3. **Sample size.** 44 accounts is enough to see the record shapes and that unmigrated users exist. It is too small to estimate rates precisely.
4. **Timing.** One container, sequential calls, one PDS host (`tngl.sh`) in 26 of 44 samples. Re-measure from production delivery logs.
5. **Indexer.** `apps/indexer` watches only `app.bsky.actor.profile` (see `apps/indexer/src/handlers.ts`), so a Tangled avatar change does not trigger cache warming. Adapters are read at request time, so delivery is correct, but warmed sizes are not refreshed for Tangled changes. Out of scope here.
6. **Avatar size.** One legacy avatar was 2,533,667 bytes, above the lexicon's 1,000,000 byte limit. Delivery's own size caps still apply.
7. **Maintainers not asked.** See the decision section.

## Sources

- `com.atproto.sync.listReposByCollection` and `com.atproto.repo.listRecords` and `getRecord`, called live on November 7, 2026.
- [Tangled core commit of November 2, 2026](https://tangled.org/tangled.org/core/commit/02d9ff54fcdb96ae5665feb794aa14ba24302a79) and [`org.tangled.actor.profile` lexicon](https://tangled.org/tangled.org/core/blob/master/lexicons/org/tangled/actor/profile.json).
