# Changelog

New features, changes, and fixes to BlueyVatar, newest first. Each entry is dated and grouped under Added, Changed, and Fixed. Early entries come from the titles of merged pull requests.

## 2026-11-15

### Added
- Avatar calendar (closes #219, migration 0044). A new Avatar calendar page under Profile in the account menu lets Plus accounts choose which of their original images is the default on which day, with date entries and a weekly repeat. A time zone is required (prefilled from your browser) and decides when a day starts. The page shows what today shows and the next change. A scheduled job in the indexer asks the web app to change the default image and push it like any default change. When no entry applies, your own default comes back. A saved frame or filter stays applied, out-of-office wins while it is on, and deleting an image removes it from the calendar. Settings are kept by BlueyVatar, are in the data export, and are deleted with your account. Uses the existing `EFFECTS_TICK_SECRET` (see `docs/calendar-v1.md`).
- Date logic for the avatar calendar (part of #219). A new pure module in `packages/core` works out an owner's local date in their time zone, finds local midnight by searching for the instant the date changes (so daylight saving shifts, 30 and 45 minute zones and invalid zones are handled), validates a schedule of date and weekly entries, and reports the active entry and the next time it changes. No visible change yet; the editor and the scheduled switch follow.
- More frames and image filters on the Effects page (part of #218, migration 0042). Plus accounts get three more rings (thick, dotted, inset) and five filters (black and white, sepia, warm, cool, high contrast). A look is one frame, one filter, or one of each, drawn from your original and saved as a new image like the other effects. The out-of-office badge stays free. The data export includes the filter. See `docs/effects-v2.md`.

### Changed
- Signing in now asks Tap to follow your account (`POST /repos/add`), so the indexer records it right away, even before you save a profile (closes #223). It is best effort with a 2 second limit and never blocks sign-in. It runs only when `TAP_URL` and `TAP_ADMIN_PASSWORD` are set on the web app.
- Signed-in visitors on public pages (part of #225). The landing page button now asks `/api/viewer` in the browser instead of reading the cookie on the server, so `/` is a static page again and no signed-in copy can reach a signed-out visitor. Pages that read the session on the server (`/login`, `/account`, `/report`, `/integrations`, profile pages) now send `Cache-Control: private, no-store`. Assets and `/img` caching are unchanged. The `www` redirect and the `PUBLIC_URL` host check are still owner steps.

## 2026-11-14

### Added
- Bug report screenshots are now stored (part of #266, migration 0040). The picture is cleaned again on the server (metadata removed, shrunk, 1 MB cap) and kept in a new `bug_report_screenshots` table. The GitHub issue links to `/admin/bug-reports/<id>/screenshot`, which opens only for signed-in admins with a live admin session. Screenshots are deleted after 90 days by an indexer job and with the reporter's account, and are in the data export. The privacy page says so. Issues are now filed with the title rules and the `bug` label from the Cdaeris feedback issue conventions (no `Bug report:` prefix, no `area:web`).
- Effects page (part of #218, closes #283). A new Effects page under Profile in the account menu. Out-of-office is free: pick a first and last day and a time zone, and your default image gets a small umbrella badge for those days, then your previous default comes back (also when you turn it off early). Frames are for the Plus plan: a plain, double, or dashed ring in one of six colors around a round version of your picture. Each look is drawn from your original image and saved to your Bluesky account as a new image, so it passes the same checks as an upload, counts toward your image limit, and is served and pushed like any avatar. Settings are kept by BlueyVatar (migration 0041). The scheduled switch runs in the indexer and needs `EFFECTS_TICK_SECRET` on the web app and the indexer (see `docs/effects-v2.md`).
- Integrations page: choose per app whether BlueyVatar pushes your default image as that app's profile picture (part of #298). Bluesky and Tangled each have a box. Ticking one asks your Bluesky account's home server for the permission to change that one app's profile record, and nothing else; sign-in for everyone else is unchanged. If your account has no profile record for the app, BlueyVatar asks before creating one that holds only your picture. Images rated R or X are never sent. Unticking stops future pushes and leaves the record as it is. Adding an app is one entry in `lib/push-apps.ts` (see `docs/integrations-push-v1.md`). The page stays off until `OAUTH_PUSH_APPS` is set, which waits for a staging test (migration 0039).
- A bug report button on every page (part of #266). Signed-in people describe the problem, optionally capture the page or attach a picture, and the server files a GitHub issue labeled `bug` and `area:web`. It is hidden until the owner sets `GITHUB_FEEDBACK_TOKEN` (see Bug reports in `docs/deploy.md`). Reports are limited to 5 per account and 20 per network per hour. Screenshots are shrunk and stripped of metadata in the browser and are not stored or uploaded yet.
- Expiry reminder emails (part of #236). A scheduled job in the indexer emails the key owner once, 7 days before a key that has an expiry date stops working. Each key gets one reminder, tracked in a new `api_keys.expiry_reminded_at` column (migration 0039). Forever keys, revoked keys, and keys already expired never get one.

### Fixed
- The profile permission is now `repo:app.bsky.actor.profile?action=create&action=update` instead of `action=update` alone (#297). The reference server checks both actions on every profile write, so the narrower permission would have been refused. A permission with only one of the two is treated as not granted.
- CI now installs pnpm into each job's own folder (`dest` on the pnpm setup action). The default folder in the runner user's home was shared by every runner on the machine, which still caused "pnpm: command not found" when jobs overlapped.
- CI jobs sharing the self-hosted runner no longer collide. Each job has its own pnpm folder and store (fixes "pnpm: command not found"), the e2e and accessibility servers use free ports chosen at run time (fixes "port 3100 is already used"), and CI runs queue per ref instead of cancelling. Locally, `E2E_PORT` still defaults to 3100.

### Changed
- Avatar effect settings are part of the data export and are deleted with your account (part of #218). The export lists your frame choice, out-of-office dates and time zone, and the default image to restore. The download and deletion lists on the Danger zone page now name effect settings and bug report screenshots.
- Linked accounts everywhere a person reads them (part of #239): the Markdown export heading, the removal notice email, the security notice on the account page, the hovercard README, and the QR redirect description in the API reference. The export reference moves to `docs/api/exports-and-qr-v2.md`.
- Account pages are finished on one standard (part of #239). New shared parts: `Section` (heading, one-line description, content, danger tone), `Field` (label, hint, error, required marker), a red `danger` button variant used for delete, revoke, remove, and unlink, an empty-state block with a next action, and a back link on sub-pages (Import an avatar, an organization, its billing page, Danger zone, and a chosen appeal). Every account page now has one intro sentence under its title. The standard is now `docs/page-standard-v2.md`.
- "Verified accounts" is now "Linked accounts" everywhere a person reads it: the public profile list and the Plus plan description (owner decision on #239). The API keys page uses the shared `Section` and `Button` parts, and Revoke is the red button.
- The Verified accounts page and menu entry are now "Linked accounts", and the landing page button "Claim your avatar" is now "Set up your avatar" (owner decisions on #239). "Custom profile domain" keeps its name.
- Account pages share one page layout (part of #239). A new `PageHeader` component (heading, optional one-sentence intro, optional action buttons) opens every account page, and the type scale, intro size, and content widths are named in `app/tokens.css`. The API keys menu label and page heading are now "API keys" (the license moved to Plan and billing). A test fails when a menu label and its page heading differ, or when an account page has a bare heading instead of `PageHeader`. The standard is written down in `docs/page-standard-v2.md`.
- The profile picture push replaces the sign-in permission and the automatic switch from #241 (part of #298). The permission is no longer requested at every sign-in, and nothing is pushed until you tick an app's box. The Avatars page keeps a "Push to <app>" button on each image for apps you allowed, and the undo. `OAUTH_REQUEST_BSKY_PROFILE` is replaced by `OAUTH_PUSH_APPS`.
- The API docs `README`, `errors`, `examples`, and `usage` pages are now version 2 (`docs/api/*-v2.md`), after the revisions in #304. The usage page now says usage is shown on Plan and billing. Links, the docs site build, and the OpenAPI test follow the new names.
- The home server wording is "your Bluesky account's home server" on first mention and "home server" after that, in the shared term and in the error messages from the repository code (part of #223).
- Every notification email now shows your handle on the "Account:" line, falling back to the account ID (part of #239).
- The profile menu in the header shows your own avatar, and keeps the letter when you have none (part of #239).
- API key choices follow the owner's decisions on #236 (part of #236). When you create a key the lifetime choices are Forever (the default), 30 days, 90 days, and 1 year. Forever means the key has no expiry date and never stops working; existing keys are unchanged. Rotating a key keeps its lifetime. The two key types are now named "Website key (read only, safe to put in a web page)" and "Server key (read only, keeps usage and stays private)" on the keys page, in the API docs and OpenAPI description, and in the notices. A new expiry reminder email template exists for keys that expire; Forever keys never get one. The reminder is not sent yet.
- Every linked email is now stored encrypted, so the Account page shows each address in full under Linked emails (part of #223). Emails linked earlier show masked, with "address not stored, link it again to show it", until you link them again. The privacy page and the data export describe this (migration 0037).
- "PDS" is now "home server" in user-facing text, with "your Bluesky account's home server" on first mention and a one-line explanation (part of #223). The Your data page shows both your handle and your account ID (part of #236).
- The paragraph above "Upload an image" has the approved wording with your plan's image limit (part of #227).
- The gallery upload form on the Account page now shows "If R, label as" only when the rating is R, like the avatars page (part of #227).
- Tests now cover the signed-in and signed-out header and footer links and the pricing buttons (part of #225).
- The API keys page is now about keys (#236). Its heading stays "API keys and license" until the menu label is renamed to "API keys". The License section, plan limits, usage history, last 30 days, and usage alert status moved to Plan and billing, for your account and for organizations. The page shows your handle, not your account ID, on Plan and billing too (part of #237). The revoked-key email names the key in the subject and first line (an unnamed key reads "Unnamed key, created 2026-11-08") and the "Account:" line shows your handle, falling back to the account ID.

## 2026-11-08

### Changed
- `localdeploy.bat` (v3) now ends a production run with `pnpm lexicons:publish`, asking first unless `--yes` is given. It checks the three `LEXICON_PUBLISH_` variables and `pnpm` before any deploy starts. Staging-only runs skip it, and `--no-lexicons` turns it off.
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
- The deploy runbook's environment variable table lists `STRIPE_PRICE_PLUS` and `STRIPE_PRICE_BUSINESS` for Stripe billing, with `STRIPE_ALLOW_PROMO_CODES` as optional. It no longer lists `STRIPE_PRICE_PRO`, since Plus and Pro are one plan.

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
