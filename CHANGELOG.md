# Changelog

New features, changes, and fixes to blueyvatar, newest first. Each entry is dated and grouped under Added, Changed, and Fixed. Early entries come from the titles of merged pull requests.

## 2026-11-08

### Changed
- Landing page: removed the handle pill from the hero graphic, and the developer samples use a neutral example handle. "Claim your avatar" goes to your account when you are signed in.
- Sign-in page: clearer handle help with an example and a note about custom domains, and the handle is checked in the browser and on the server. Signed-in visitors go straight to their account.

## 2026-11-07

### Changed
- Moderation review SLA defaults to 72 hours for every severity, set by the owner. `MODERATION_SLA_HOURS` still overrides each severity (#209).

### Added
- Moderation review portal: queues for unreviewed, escalated, appeal, resolved, and restricted child-safety cases, ordered by severity then age with SLA timers, one case per image or account, one reviewer lock per case, actions that require a reason and a cited policy, blurred and grayscale images with logged reveals, Article 17 statements of reasons that cannot be sent with an empty field, an append-only audit log, and review metrics on the admin home (#209). Reviewer guide in `docs/moderation-v1.md`.
- Daily moderation digest email from the indexer (counts only, skipped on a quiet day), and a child-safety option on the report form (#209).
- Upload screening through the PhotoDNA Cloud Service (off until configured) and enforcement of atproto moderation labels, with policy and privacy updates (#207).
- Integration guides for plain HTML, WordPress, Ghost, and Discourse, and a WordPress plugin source with PHP lint and unit test in CI (#177).
- Delivery caps concurrent image resizes (default 2 for the 512 MB VM), queues briefly, and answers 503 with Retry-After when full; metrics for in flight, queued, and shed (#198).
- Skip link, accessibility statement at /accessibility, and an automated axe-core check in CI (#171).
- Web admin page with an audit log for moderation (#165).
- Self-serve data export and deletion (#166).
- First-run checklist, settings hub, and signed-in sessions (#168).
- Email notices to reporters when a report is dismissed or actioned (#169).
- Email notices to account owners about usage, billing, and keys (#163).
- Stripe billing: Checkout, Customer Portal, and a signed webhook (#133).
- Plus plan sold through Stripe, with the email domain stored on links (#137).
- Gallery upload page for Plus users (#129) and the image gallery behind it (#123).
- Account verification on more platforms (#139).
- Tangled profile adapters, with a fallback to the legacy ones (#131), and indexing of Tangled profiles (#135).
- Robots rules, sitemap, canonical URLs, Person JSON-LD, and a pricing page (#157).
- Integrations page listing atproto apps (#159).
- Logging, readiness checks, error tracking, and metrics (#158).
- Post-deploy smoke test and a web browser test suite (#167).
- Self-hosting guide, CONTRIBUTING, and SECURITY files (#118).
- AGPL-3.0 and Apache-2.0 license files (#121).
- Common avatar sizes are warmed through the CDN (#120).
- Primary email is stored encrypted so ownership can be revoked and previous owners notified (#117).
- The web app has a new look based on the Chrysalis design with the monarch palette (#109).

### Changed
- Uploaded images no longer keep location, camera, or other photo metadata. Every upload is re-encoded in the browser and on the server with EXIF, XMP, and IPTC removed, the orientation applied, the color profile kept, and the full resolution kept (#206).
- Uploads keep the full original image. Any resolution is accepted and shrunk to at most 4096 pixels on the long side, in the browser first and on the server as a fallback, and the upload limit is now 5 MB. The crop box saves a `crop` field on the image record instead of cropping the file, and delivery applies it before resizing (#203).
- Delivery batches rate-window and usage counter writes in memory and flushes them every second (#198).
- Web routes are rate limited and each account has abuse caps (#156).
- Server logs are kept for 90 days or until a size cap is reached (#164).
- Faster Tangled adapters (#135).
- getBlob requests are checked more strictly, tell a missing blob from a server fault, retry, and use caches (#126).
- The upload hint now says cropping happens at delivery, not in the browser (#130).
- Image formats and quality are tested, and avatars are square only (#119).

## 2026-11-06

### Added
- A QR code that leads to a profile or redirects to a verified social account (#96).
- Signed image paths, so size caps by plan and visibility rules hold on image URLs (#97).
- MD5 email hashes are accepted on `/avatar` (#86).
- The default image is served for profiles marked `!no-unauthenticated` (#87).
- The remaining default avatar styles (#83).
- Gravatar parameter parity: `d=blank`, `name=`, and `updatedDate` (#110).
- A report and takedown flow with a content policy (#111).
- Email hash ownership: one account per hash, a cap per account, a primary address, and a 30-day hold (#105).
- Profile links, time zone, interests, and link previews (#101).
- The `@blueyvatar/hovercards` package, with `/profile` limited by plan (#100).
- Claims are re-verified on a schedule and revoked after 3 failures (#107).
- The Cloudflare cache is purged when an operator blocks an image (#102).
- API reference for hashing, JSON mode, ttl, and errors (#98).
- Upload guidance: square crop, an 80px minimum, client resizing, and rating examples (#104).

### Changed
- OAuth session and state tokens are encrypted at rest (#106).
- API polish: `retry-after` headers, error handling, JSON responses on misses, and cleanup (#112).
- Hash lookups look the same for unlinked, opted-out, and restricted avatars (#90).

### Fixed
- `/img` accepts only the size ladder and canonical parameters (#88).
- Sign-in redirects are built from `PUBLIC_URL`, not the bind address (#81).

## 2026-11-03

### Added
- First release of blueyvatar: the scaffold, spec v6, and the phase 1 build (#1).
- Image transforms, TTL, QR codes, hovercards, and avatar import (#73).
- Locked-down origin, custom profile domains, and verified accounts (#74).

### Changed
- Hosting moved from Railway to Fly.io and Neon (#75).
