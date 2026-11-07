# Atproto spaces status and fit for restricted avatars (v1)

Checked: November 7, 2026. Scope: issue #65 (Q8, atproto spaces timing; spec section 13 item 8 and section 10.2). Sources are primary only: atproto.com blog and specs, and github.com/bluesky-social pages. Spec references are to `docs/spec/blueyvatar-product-spec-v9.md`; code references are to `origin/main` at `fdac76a`. I read the pages listed below and did not run any spaces code. "No published answer" means none of the pages I reached states it.

## Decisions needed

1. **Keep the service-stored avatar option for v1.** Spaces are not launched, the design is a draft, and the alpha post says not to run production code against it. Decide whether to keep spec 10.2 option 1 as the only real access control until spaces ship. Recommendation: yes.
2. **Treat spaces as a later phase, as the spec already says.** Re-check on a fixed date (suggested: December 15, 2026, after the "later this year" target) and again at any announcement of a launch.
3. **Whether blueyvatar should be a space reader at all.** Reading a restricted avatar from a space needs a signed-in user to delegate access on every sync, because the service has no standing credential. This is a different trust model from today's. See "Can blueyvatar read space content". The owner should decide before any prototype starts.

## Status as of November 7, 2026

Spaces are not launched. The newest primary source says the launch is "over the next several weeks" and gives no date.

| Date | Event | Source |
| --- | --- | --- |
| Jul 2, 2026 | Draft PR #5187 "Atproto spaces" opened on `bluesky-social/atproto`. It is still open and marked Draft, body "WIP", last activity Nov 5, 2026 | [PR 5187](https://github.com/bluesky-social/atproto/pull/5187) |
| Aug 20, 2026 | Alpha announced. "This is truly an alpha. There will be breaking changes, and you absolutely should not run production code against it." No security review, no backups, hosted alpha PDS will be removed after the alpha | [Alpha post](https://atproto.com/blog/atproto-spaces-alpha) |
| Oct 14, 2026 | Devex post: two rounds of breaking changes since the alpha, "We expect to launch atproto Spaces this year", team "confident that most pieces are going to stop churning from here" | [Devex goals](https://atproto.com/blog/devex-goals-for-spaces) |
| Oct 22, 2026 | Groups intro calls the group model "the proposed spec". Gives no launch date | [Atmospheric groups](https://atproto.com/blog/atmospheric-groups-intro) |
| Oct 29, 2026 | "Open Social Groups, the Vision" (part of the same series). I did not read it | [Index entry](https://atproto.com/blog/topic/spaces) |
| Nov 6, 2026 | Spaces-compatible Jetstream described as a prototype. "as we approach the Spaces launch over the next several weeks" | [Space sync](https://atproto.com/blog/space-sync) |

Newer than the alpha announcement (the question the issue asked): yes, the four posts from October 14 to November 6 above. None announces a stable release.

Other signals checked on November 7, 2026:

- The [atproto blog index](https://atproto.com/blog) lists no post after November 6 and no stable-launch post.
- The [atproto releases page](https://github.com/bluesky-social/atproto/releases) shows releases through November 6 (`@atproto/dev-env@0.7.5`). None of the ten newest mentions spaces. The reference PDS spaces build ships as the Docker tag `ghcr.io/bluesky-social/atproto:pds-spaces-alpha`, not as a normal release.
- The [permission spec](https://atproto.com/specs/permission) does not mention a `space:` scope or spaces. The `space:` scope appears only in the proposal and the devex post.
- The [proposal 0016](https://github.com/bluesky-social/proposals/tree/main/0016-permissioned-data) README says: "This is a proposal, not the final specification." and "the implementation itself is still very much a work in progress."

Launch date: no published answer. Stability of the XRPC method names and token formats: no published answer beyond the devex post's statement of confidence.

## What the API offers for private records and blobs

From proposal 0016 (draft, so names may change). Methods live under `com.atproto.space.*`.

**Model.** A space is identified by an authority DID, a space type NSID, and a space key. Each member's records live in a per-space repo on that member's own PDS. Space URIs look like `at://{spaceDid}/space/{spaceType}/{skey}/{authorDid}/{collection}/{rkey}`. Spaces give "access control, not confidentiality": the data is not encrypted and servers can read what they handle.

**Records.**
- Writes: `createRecord`, `putRecord`, `deleteRecord`, `applyWrites`, `clearRecords` on the PDS. OAuth only.
- Reads: `getRecord`, `listRecords`, `getLatestCommit`, `getRepo`, `listRepoOps` on repo hosts. OAuth or a space credential.
- Space management: `createSpace`, `updateSpace`, `deleteSpace`, `listSpaces` (OAuth).
- Baseline policies every PDS must support: `personalspace` (only the authority account reads), `memberspace` (member list with read and write flags, optional `publicRead` and `allowedApps`), and `managedspace` (each decision goes to a managing app).

**Blobs.**
- "Blobs referenced by records in a space are stored on the authoring repo's host and fetched via `com.atproto.space.getBlob`." `listBlobs` lists referenced CIDs. Reads use the same credential rules as record reads. Blobs are not in repo archives.
- Blob upload for spaces and the write permission for it: no published answer. The proposal does not define them.
- Whether the existing `blob:image/*` OAuth scope covers space blobs: no published answer. The permission spec says nothing about spaces.
- Image resizing or CDN delivery of space blobs: no published answer.

**OAuth scope.** The proposal defines a `space:` scope with parameters `authority`, `skey`, `collection`, `action` (`read`, `read_self`, `create`, `update`, `delete`) and `manage`. "Read access is all-or-nothing at the space boundary." The devex post gives one example, `space:com.example.notes`. A published scope catalog: no published answer.

## Can blueyvatar read space content, and how authorization works

**Short answer.** Yes in principle, but only through a path the space authority approves, and not with a standing service credential. The sources describe three ways in.

1. **Public-read member space.** Under `memberspace` with `publicRead`, "no delegation token is needed. The authority issues a credential to any requester, subject to `allowedApps` if set." This is the only no-user path. A publicly readable space is not private, so it does not help restricted avatars.
2. **A signed-in user delegates.** The user's PDS mints a delegation token (single use, about 60 seconds, addressed to the authority). The service, with a client attestation JWT signed by its own client key if the space gates on app identity, exchanges it at the authority's `getSpaceCredential`. The credential lasts 10 minutes by default and 60 at most, is signed by the authority, and is bound to a P-256 key the service holds. Each read carries an HTTP Message Signature. The authority "decides whether to issue" the credential, and the protocol does not define that decision procedure (that part: no published answer).
3. **Managed space.** The authority asks a managing app (`checkUserAccess`) whether the user may read.

**Sync.** There is no relay for spaces. The Nov 6 post says a space sync service "never holds users' OAuth tokens", requests "a short-lived delegation from a user who already has read access", and "If that user signs out or loses access, the service must find another eligible reader or stop syncing the space." Authorities send signed write notifications (checked against the authority's DID keys) that carry no record data. The stream is "meant for your app's backend" and "contains records from every space the service follows, so the app must enforce per-viewer visibility itself." That is the prototype Jetstream for spaces; it is not launched.

**What this means for a third party like blueyvatar.**
- The service can read a space only while some user with read access is signed in and delegating, or the authority issues credentials to the service under its own policy. A standing "service account" read right: no published answer.
- Per-viewer enforcement is the reader's job. blueyvatar would apply its own caller rules (license key, Origin) on top of the space-level gate, which the authority cannot see.
- Revocation is by short expiry (credentials) plus optional `notifyCredentialRevoked`. Repo hosts keep each revocation at least 60 minutes. A leaked avatar image served by blueyvatar is not covered by any of this once it leaves the service.
- Authorship proof for space data is deliberately not durable (an HMAC from an ECDH shared secret instead of signatures), so a copy that escapes the boundary cannot be attributed.

## What would change in blueyvatar's restricted-avatar design

Today (code at `fdac76a`, spec 10.2):
- Rules (Keyed only, Domain allowlist) are checked by `visibilityAllows` in `apps/delivery/src/app.ts` from the service's own database.
- A restricted avatar's redirect target is a signed `/img` path whose scope is the caller's key id or allowed origin host plus a day bucket (`restrictedScope` in `packages/core/src/sign.ts`). A path with no scope for a restricted DID gets 403 `access_denied`.
- Hash lookups run the database-only gate before any network identity resolution, so unlinked, opted-out, and restricted hashes return the same default response (spec section 10, enumeration paragraph).
- The avatar blob stays public on the user's PDS, which the spec states as an "Important limit".

If spaces ship and a user stores the avatar in a space, the likely changes are below. Items that need an unpublished answer are marked.

| Area | Change | Basis |
| --- | --- | --- |
| Lexicon and storage | Avatar image records for a private avatar would be written into a space, not `com.blueyvatar.image` in the public repo. The public repo would need a separate pointer or nothing at all. Pointer design: no published answer | Proposal URI and repo model |
| Fetch path | Replace the public `com.atproto.sync.getBlob` call with `com.atproto.space.getBlob` plus a space credential, obtained per the delegation flow above | Proposal, blob section |
| Credentials | The service needs an OAuth client key for attestation and a stored mapping from space to an eligible delegating user. Credentials expire in at most 60 minutes, so refresh logic is required. Token handling must follow "never holds users' OAuth tokens" for the sync service | Space sync post |
| Rules layer | Unchanged for callers. The existing Keyed only and Domain allowlist checks, the scoped signed `/img` paths, and the same-response enumeration rule all still apply. The space gate is an additional condition on the service's read, not a replacement for caller rules | Space sync post: reader enforces per-viewer visibility |
| Caching | A resized image served from `/img` is a copy outside the space. The existing per-caller, day-bucket scope still bounds a leak to the next day. A shorter scope for space-backed avatars is a choice, not a requirement from the sources | `sign.ts` |
| Availability | If no eligible reader is signed in, the service cannot refresh the source image. Behavior to choose: serve the last cached copy until the scope expires, or return the default. The sources do not define it | Space sync post |
| Indexing | Today the indexer follows the public firehose through Tap. Space records do not appear there. Indexing needs the spaces sync path. A launched Tap or Jetstream support for spaces: no published answer; the prototype is described on Nov 6 | Alpha post: "there is no concept of a relay" |
| Copy to the user | The sign-up note in spec 10.2 changes for space-backed avatars: access control is real at the PDS, but blueyvatar still serves a derived copy to authorized callers, and spaces are not encrypted | Alpha post |

## Prototype plan once stable

Start only after all of these hold: an announcement of a stable launch on atproto.com; the proposal marked as a specification, or the lexicons merged to `main` of `bluesky-social/atproto`; a documented `space:` scope and blob upload path; and a hosted or self-hosted PDS build that is not the alpha tag.

1. **Read-only spike, no repo changes.** Run a spaces-enabled PDS in a scratch environment. Create a `personalspace` with one record that references an image blob. Confirm that `getBlob` works with a space credential and fails without one.
2. **Delegation flow.** Implement the delegation token to `getSpaceCredential` exchange from a test OAuth session. Record the real token lifetimes and the failure modes when the user signs out.
3. **Upload path.** Learn how a client uploads a blob that a space record references, and which scope it needs. This is the largest open question today.
4. **Delivery integration (behind a flag).** In `apps/delivery`, add a source resolver that returns bytes from a space for DIDs with a private avatar. Keep `visibilityAllows`, `restrictedScope`, and the gate unchanged. Add tests: the same-response rule still holds for a space-backed restricted hash, a revoked credential yields the default, and `/img` without a scope returns 403.
5. **Indexer.** Prototype the spaces Jetstream or sync service example the Nov 6 post says is "coming soon". Decide whether blueyvatar follows spaces by user delegation only.
6. **Review.** Security review of storing delegation material, a decision on caching of derived copies, then an owner decision on rollout.

No application code is changed by this PR.

## Is the service-stored avatar option still needed

Today: yes. Spaces are an alpha, not for production, and do not exist as a stable feature. Spec 10.2 option 1 remains the only real access control.

After a stable launch: not decided by any published source, so the decision stays open. These facts bear on it, all from the sources above:
- A space-backed avatar keeps portability, which the service-stored option loses.
- The service still needs a delegating reader or an authority policy that admits it. A user who wants a private avatar in a space but does not run a signed-in session against blueyvatar would see the avatar go stale or fall back to the default.
- Blob upload, image tooling, and Tap or Jetstream support for spaces are not published as stable.
- Spaces are unencrypted, as is the service's own storage, so neither option offers confidentiality from the operator.

Recommendation: keep option 1 in the spec and plan for it. Revisit after the prototype above answers the upload, delegation, and availability questions. Only then decide whether option 1 shrinks to a fallback or stays a first-class choice.

## Sources

- [The Atproto Spaces Alpha is Live](https://atproto.com/blog/atproto-spaces-alpha), August 20, 2026
- [Developer Experience Goals for Atproto Spaces](https://atproto.com/blog/devex-goals-for-spaces), October 14, 2026
- [An Intro to Atmospheric Groups](https://atproto.com/blog/atmospheric-groups-intro), October 22, 2026
- [A Jetstream for Spaces](https://atproto.com/blog/space-sync), November 6, 2026
- [Spaces blog topic index](https://atproto.com/blog/topic/spaces) and [blog index](https://atproto.com/blog), read November 7, 2026
- [Proposal 0016, permissioned data](https://github.com/bluesky-social/proposals/tree/main/0016-permissioned-data)
- [atproto PR 5187](https://github.com/bluesky-social/atproto/pull/5187)
- [atproto releases](https://github.com/bluesky-social/atproto/releases)
- [Permission spec](https://atproto.com/specs/permission)
- Previous research: `docs/research/img-access-rules-and-size-caps-v1.md`
