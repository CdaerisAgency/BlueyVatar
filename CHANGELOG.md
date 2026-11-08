# Changelog

New features, changes, and fixes to BlueyVatar, newest first. Each entry is dated and grouped under Added, Changed, and Fixed. Early entries come from the titles of merged pull requests.

## 2026-11-08

### Changed
- The Deploy workflow now deploys in one run when started by hand (Actions > Deploy > Run workflow, or by asking in chat): staging, a smoke test against staging, production, then a smoke test against production. Production is skipped if staging fails. Merging does not deploy. The `target` choice can be `staging` only. Tap is still deployed by hand, and `localdeploy.bat` stays for emergencies. Rollback steps are in `docs/deploy.md`.
- The default sender address for one-time-code emails is now support@blueyvatar.com.

### Added
- Account menu: an Overview link above the groups, Organizations under Identity, Profile views under Profile, and Appeal under Settings (part of #243). The home page heading is now Overview and the appeal page heading is Appeal. Nested pages such as an organization's page keep the right item highlighted.
- The account data export now includes your Bluesky avatar sync setting and the log of changes blueyvatar made to your profile avatar (part of #241). Only your own rows are listed, with no account ID or row numbers.
- Download your profile and get a QR code with your logo or avatar (part of #242). The public profile page and the Profile page now have Download JSON, Markdown, and vCard links, and a QR code section with plain, logo, and avatar versions. The files hold only what visitors can already see, and only the wallets you chose to show, marked not verified. The delivery API serves them at `/profile/{id}.json`, `.md`, and `.vcf`, and `/qr/{id}.png` takes `center=none|logo|avatar` and `quiet`. Exports and QR codes are open to every plan, including the QR code that used to need a Business key.
- Languages, links, and wallets on your profile (part of #242). Add them on the Profile page with Add and Remove buttons and live character counts. Languages use language tags such as en or pt-BR and one can be marked primary. Links must start with https://. Wallets are hidden unless you check Show on my public profile, and shown wallets say "not verified". The profile JSON gains `languages`, `socialLinks`, and `wallets`.
- Plan and billing: people with a paid plan can switch between Plus, Pro, and Business, cancel at the end of the period, and resume before it ends (#237). The page shows your plan, price, status, and renewal or end date in plain words, and the pricing page buttons send paid members to the same confirm step. Upgrades charge the difference now, and downgrades add a credit to the next invoice. Card and invoices stay under Manage billing. When billing is not set up, the page says so and gives support@blueyvatar.com.
- API keys can expire (#236). When you create a key you choose 30 days, 90 days, 1 year (the default), or never. An expired key stops working at the API (error code `key_expired`) and shows as Expired on the API keys page. Existing keys never expire. A new key is shown once with a Copy button, key types are explained in plain words (Website key and Server key, both read only today), the tiers table is gone from the page, and a key with no name gets one such as "Unnamed key, created 2026-11-08". The revoked-key email now puts the key name in the subject.
- Change your Bluesky profile avatar from BlueyVatar (#241). A "Use as my Bluesky avatar" button on each G or PG image, a switch to keep your Bluesky avatar the same as your default image (on by default once you allow it), and "Restore my previous Bluesky avatar". BlueyVatar changes only the picture, keeps the rest of your profile exactly as it is, and never overwrites a change you made on Bluesky in the meantime. R and X images are never sent. The permission is requested at sign-in once the `OAUTH_REQUEST_BSKY_PROFILE` setting is on, which stays off until it is tested on staging. Until then, and for existing sessions, the page says "Sign in again to allow this".

### Changed
- Downgrading from Business to Plus now takes effect at the end of the current billing period instead of right away. You keep Business until the period ends, then move to Plus with no credit and no refund. The Billing page shows "Your plan changes to Plus on <date>" with a button to cancel the scheduled change and keep Business, and gains a short "How changes work" note (upgrades apply now and are charged the difference, downgrades and cancellations apply at the end of the period, partial periods are not refunded). Upgrades are unchanged. The Stripe webhook endpoint needs two new events: `subscription_schedule.updated` and `subscription_schedule.completed`. Draft terms for counsel review are in `docs/legal/terms-draft-v1.md` and are not live.
- The logo in the site header now reads BlueyVa’tar, with an apostrophe between the a and the t. The name stays BlueyVatar everywhere else, including page titles, text, and screen readers.
- Plus and Pro are now one plan. Plus costs $9 per month and includes 20 avatar images, a profile gallery, a custom profile domain, up to 20 verified accounts, 50,000 requests a month, hovercards, and priority cache warming. Business ($49 per month) includes everything in Plus plus 1 million requests a month, custom domains, and a support contact. QR codes are available on every plan. Pro is no longer sold; anyone who already had Pro keeps access as Plus. The pricing page and home page show Free, Plus, and Business, with Plus as the most popular plan, and plan switching on the Billing page offers Plus and Business.
- Wording works for accounts hosted anywhere on atproto, not only Bluesky's servers (#246). The avatar sync says "Use as my avatar on <your server name>", messages name "your account's home server" and "your profile" without a brand, and sign-in, report, privacy, policy, and domain text no longer assume a Bluesky account. If your server has no profile record, the page says so plainly. The product spec is now v11.
- Verified accounts page: starts with a plain definition of a claim, shows numbered next steps with Copy buttons under each account that still needs checking (link back to your profile, a line of text for a Bluesky bio, or a TXT record for a domain), and explains the rel="me" tag once in a short note. The button is now "Add account", and hide and show buttons say "your profile" instead of "hovercards" (#238).
- Account pages share one page standard (content width, title size, and spacing are named tokens), links between pages use each page's menu name (API keys and license, Plan and billing, Danger zone, Verify), and the Verify page uses the standard width (#239).
- Sign in, report, avatar import, custom domain, create organization, and add member forms keep what you typed after an error, list every problem beside its field, and move focus to the first one. A rate limit, a save error, or an expired session no longer clears the form (#235).
- Account area: a nested left-side menu replaces the row of buttons (#243). Five groups (Profile, Identity, Developers, Billing, Settings) open and close, the group with the current page opens first, and on a phone the menu is a button that opens a drawer. Arrow keys move within the menu and Escape closes the drawer. Page headings now match their menu names: Verified accounts, Verify, API keys and license, Plan and billing, Sign-out options, and Danger zone.
- Profile page: the time zone is a menu with a "Not set" option and a "Use my current time zone" button, interests show both limits with a live count, the background color picker is a normal swatch that shows the chosen color, and the extra paragraph under it is gone (#231). A failed save keeps everything you typed and lists every problem beside its field (#235).
- Reporting a profile or avatar now requires signing in with Bluesky, and the reason, details (at least 10 characters), and email are all required. Reports store the reporter's account, which is limited to 5 reports per hour in addition to the per-network limit and is shown to reviewers only. The content policy lists security@blueyvatar.com for legal or urgent notices from people who cannot sign in (#224).
- The avatars page has an Upload an image button, shows your Bluesky avatar with a button to use it, shows linked emails (your primary in full, others masked), and hides "If R, label as" unless R is chosen. The limit message names the right plan (#227).
- BlueyVatar no longer asks for or stores an image license. Existing records keep working and nothing is deleted from your repository (#227).
- The link email explains how your address is used, and the account page and privacy page say "your Bluesky account's home server" instead of "PDS" (#223).
- The data export masks the domain of your primary email link, like the masked address in the same file (#223).

### Fixed
- The avatar preview and URL on the account page now point at the image host. They used the website address, which answered "Page not found". With no avatar yet, the page shows a placeholder and a Change your avatar button (#223).
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
- First release of BlueyVatar: the scaffold, spec v6, and the phase 1 build (#1).
- Image transforms, TTL, QR codes, hovercards, and avatar import (#73).
- Locked-down origin, custom profile domains, and verified accounts (#74).

### Changed
- Hosting moved from Railway to Fly.io and Neon (#75).
