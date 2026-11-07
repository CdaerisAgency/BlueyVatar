# QR code design (issues 80 and 32), v1

Status: design note. No code change ships with this note, because the profile QR already exists and the redirect half of issue 80 needs owner decisions.

## What already exists (issue 32 / F23)

`GET /qr/:file` in `apps/delivery/src/app.ts` returns an SVG or PNG QR for `{PUBLIC_URL}/p/{handle}`.

- Accepts a hash, handle, or DID plus `s`/`size` (default 256, tier-clamped) and `ttl`.
- Requires a Business or Enterprise key (gated on the `hovercards` entitlement flag, spec sections 8 and 11.1).
- Returns 404 for identities with no handle, inactive repos, and `hiddenProfile`. Returns 403 when visibility rules deny the caller.
- Renders with `uqr` 0.1.3 (`apps/delivery/src/qr.ts`), PNG via the existing sandboxed resize worker. Tests are in `app.test.ts` ("QR code (F23)") and `qr.test.ts`.

So issue 32's acceptance criteria are implemented already. Issue 80 ("leads to the profile or redirects to social") adds a redirect mode.

## Design for issue 80

**What the QR encodes.** Default stays the profile URL on `PUBLIC_URL` (today's behavior). Redirect mode would encode a Blueyvatar-owned URL, never the third-party URL itself, for example `{PUBLIC_URL}/p/{handle}/go/{platform}`. The QR therefore keeps working if the user changes or removes a link, and we control the final hop.

**Where served.** The QR image stays in delivery (`/qr/...`). The redirect target route belongs in the web app next to `/p/[handle]`, or in delivery beside the existing redirect routes. Either works; delivery already has the index store with `verifiedAccounts`, so delivery is the smaller change.

**URL shape.** Keep the extension-path convention: `/qr/{identifier}.svg?...&to=github`. `to` omitted means profile. `to` is a platform name from the user's verified accounts, not a free URL.

**Caching.** QR image responses stay `private, max-age=ttl` (key check applies). The redirect hop uses a short TTL (a 302 with `cache-control: private, max-age=300` or less) so unlinking takes effect quickly.

**Ratings and visibility.** Reuse the existing checks in order: active repo, `hiddenProfile`, `visibilityAllows`. For redirect mode additionally drop accounts with `hidden: true` (the `VerifiedAccount.hidden` flag). A hidden verified account must return the same 404 as a nonexistent one so existence does not leak.

**Abuse and phishing.** Redirect only to a `uri` from `index.verifiedAccounts(did)`, which only returns claims that have a `verified` attestation (pg-store.ts). Never accept a URL from the query string. Require `https:` and re-validate the stored URI at redirect time. Because the platform is chosen by name and the target comes from the index, there is no open redirect. Residual risk: a user verified on a platform whose profile later changes hands. Mitigation is the short redirect TTL and attestation re-checks, which are existing indexer behavior (**unconfirmed** for re-verification cadence; not found in the code read).

**Tier and rate limits.** Same gate as profile QR (Business and Enterprise). Counting redirect hits as `origin_resolution` usage is a pricing decision (see questions). The public redirect hop is scanned by anonymous phones, so it cannot require an API key; it needs IP rate limiting like the other public routes.

**Library.** `uqr` 0.1.3 is already in the lockfile and used. From `npm view`: license MIT, last modified 2026-04-03, repository `unjs/uqr`, no runtime dependencies listed in the registry output. Maintenance health beyond that (issue tracker activity, security advisories) is **unconfirmed**. No second QR library is needed.

## Open questions for the owner

1. Is redirect mode wanted at all, or does "or redirects to social" mean the profile page's social links (already shown on `/p/{handle}`)?
2. Which targets: any verified account the user marks, or one user-chosen default stored in `com.blueyvatar.profile`? A stored default needs a lexicon and schema change.
3. Should the redirect route be public and unmetered, or counted against the Business key that generated the QR (impossible on an anonymous scan without embedding a token in the URL)?
4. Is the redirect a Business/Enterprise feature like the image, or available to lower tiers?
5. Output format: SVG and PNG are both supported today; confirm no other formats are needed.
