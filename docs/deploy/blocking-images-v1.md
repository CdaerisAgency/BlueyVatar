# Blocking an image

Reports from the public form land in the `reports` table (status `open`). Moderators work them as cases in the web admin page at `/admin` (issues #145 and #209). `pnpm ops:block` and `pnpm ops:block-did` still work for emergencies, and they write to the same audit log.

### Web admin page

Admin access is off until both variables are set on the web app, and then `/admin` answers 404 to everyone else.

| Variable | Value |
| --- | --- |
| `ADMIN_DIDS` | DIDs allowed to use `/admin`, separated by commas or spaces. These accounts sign in through the normal atproto login first. |
| `ADMIN_TOTP_SECRET` | Base32 secret for the second factor. Generate one with `openssl rand 20 | base32`, add it to an authenticator app as a manual time-based entry (SHA-1, 6 digits, 30 seconds), and keep it in Infisical. |
| `CF_ZONE_ID`, `CF_API_TOKEN`, `PUBLIC_DELIVERY_URL` | The same values the ops CLI uses. With any of them unset, a block or takedown still takes effect in the database, the page says the cache purge did not run, and you purge `/img/` for the account in Cloudflare yourself. |

Sign in at `/login`, then open `/admin` and enter the six-digit code. The admin session ends after 30 minutes and can be ended earlier from the page. Wrong codes lock the account for 15 minutes after 5 failures. Every action asks for a reason and is recorded in the `admin_actions` table, which the page shows under "Audit log". Run migration 0021 before the first deploy. `/admin` is disallowed in `robots.txt`, answers `X-Robots-Tag: noindex`, and is not listed in the sitemap.

The page is a review portal with queues, cases, and a daily digest. How reviewers use it is in `docs/moderation-v1.md`. Run migration 0031 before deploying (it needs 0012, 0021, 0028, and 0030). It adds the case tables, reviewer wellness settings, rating overrides, new audit log columns, and an append-only trigger on `admin_actions`.

Review portal settings (all optional). The web app reads the first three. The indexer reads `MODERATION_SLA_HOURS` too, to count SLA breaches in the digest, so set the same value on both.

| Variable | Value |
| --- | --- |
| `MODERATION_SLA_HOURS` | Hours to first resolution per severity, as `critical=72,high=72,moderate=72,low=72` (every severity defaults to 72 hours). Missing or invalid entries keep the default. |
| `MODERATION_POLICIES` | The policy list reviewers cite, as `id=Label;id2=Label two`. Ids are lowercase letters, digits, and hyphens. Replaces the built-in list (child safety, illegal content, adult content rating, copyright, impersonation, harassment, private information, spam and abuse, no violation found). |
| `MODERATION_CHILD_SAFETY_DIDS` | When set, only these admin DIDs can open the child-safety queue or act on its cases. Unset means every admin can. Ask counsel who should have access. |

Daily moderation digest (runs in the indexer, which is always on; the web and delivery apps scale to zero). It sends counts only, never images:

| Variable | Value |
| --- | --- |
| `MODERATION_DIGEST_TO` | Address or addresses (comma or space separated) that get the digest. If unset, the indexer uses the primary email on file for the first `ADMIN_DIDS` account that has one, so also set `ADMIN_DIDS` on the indexer. With neither, nothing is sent and the indexer logs a warning. |
| `MODERATION_DIGEST_HOUR_UTC` | Hour of day (UTC, default 13) from which the day's digest may send. It sends once per UTC day. |
| `MODERATION_DIGEST_ALWAYS` | Set to `1` or `true` to send even when every count is zero. Default: skip the email on a quiet day. |
| `PUBLIC_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `TOKEN_ENCRYPTION_KEY` | Already set on the indexer for re-verification notices. The digest uses them for the portal link, sending, and decrypting the admin address. |

The digest has no Cloudflare data. Cloudflare's CSAM Scanning Tool sends its own daily email to the address set in the dashboard (Caching, Configuration, CSAM Scanning Tool), and the digest links to the dashboard so it stays on your checklist.

The portal and digest read what upload screening and label enforcement (issue #207) already write: label-origin rows in `reports` become label signals on a case, and each `match` row in `upload_scan_events` becomes a scanner signal. Every screening service wired in is a known-image hash matcher for child sexual abuse material, so a match opens a Critical case about the account in the restricted child-safety queue (the upload was refused, so there is no image). The digest counts `match` and `outage_blocked` rows as upload rejections by service, and `outage_allowed` rows as uploads let through during an outage. Ask counsel whether recording a match as a case changes anything about "actual knowledge" under 18 U.S.C. 2258A.

Reporter follow-up: when a case is resolved and the reporter left a valid email address, the portal sends them a one-line outcome message (no reason, no details), then deletes the stored address whether or not the send worked. The message uses the same email sender as account notices (`RESEND_API_KEY`).

To block one image from a shell, use the steps below. Set `REPORT_IP_SECRET` on the web app so IP hashes for the rate limit use a private salt. With `DATABASE_URL`, `CF_ZONE_ID`, `CF_API_TOKEN`, and `PUBLIC_DELIVERY_URL` set, run `pnpm ops:block -- <did> <cid> --reason "..."`. It upserts the row in `blocked_images`, then purges the prefix `/img/{did}/{cid}/` from Cloudflare (prefix purges share the 5 per minute limit). `pnpm ops:unblock -- <did> <cid>` marks the row `unblocked_at` and purges again. To take down a whole account from a shell, run `pnpm ops:block-did -- <did> --reason "..." --report <id>`. Delivery answers 404 on `/img` and skips the image in `/avatar` and `/u`, whose redirects are not cached.
