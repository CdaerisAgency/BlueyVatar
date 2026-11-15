# Linked account providers

Issue #58. Research and per-platform status: `docs/research/verified-accounts-v1.md`. Set these on the **web** app only (the indexer's re-check needs no provider keys). Every provider is off until its flag is exactly `true` and both credentials are set, so a platform whose app review is not finished stays hidden on the claims page. The redirect (callback) URL to register with every provider is `https://<PUBLIC_URL host>/account/claims/callback`. Values live in Infisical and are pushed with `fly secrets set --app blueyvatar-web`; never commit them.

| Platform | Flag | App id | App secret | Review step before you switch it on |
| --- | --- | --- | --- | --- |
| Instagram (Business and Creator accounts) | `VERIFY_INSTAGRAM_ENABLED` | `INSTAGRAM_APP_ID` | `INSTAGRAM_APP_SECRET` | Meta Advanced Access (App Review and Business Verification) for `instagram_business_basic` |
| Threads | `VERIFY_THREADS_ENABLED` | `THREADS_APP_ID` | `THREADS_APP_SECRET` | Meta App Review for `threads_basic`, and the app must be published |
| TikTok | `VERIFY_TIKTOK_ENABLED` | `TIKTOK_CLIENT_KEY` | `TIKTOK_CLIENT_SECRET` | Submit the app for review in the TikTok developer portal (scope `user.info.profile`) |
| YouTube | `VERIFY_YOUTUBE_ENABLED` | `GOOGLE_CLIENT_ID` | `GOOGLE_CLIENT_SECRET` | Google OAuth verification for the `youtube.readonly` scope; until then Google caps the number of accounts that can grant access |
| Twitch | `VERIFY_TWITCH_ENABLED` | `TWITCH_CLIENT_ID` | `TWITCH_CLIENT_SECRET` | None found. Register the app with a Twitch account that has two-factor authentication on |

GitHub keeps `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Mastodon needs no keys (the app registers itself per instance). A claim on **Domain** (TXT record `_blueyvatar.<domain>` with the value `blueyvatar-verify=<DID>`) or **Bluesky** (own account, or the same proof text in the other account's bio) needs no keys either. With the Instagram flag off, Instagram claims use the rel="me" page check.

Migration `0018_verified_accounts_providers.sql` widens the `verification_state.provider` check. Run it before switching any provider on. The re-verification job runs the DNS and Bluesky proofs again. For provider claims the token is not kept, so it re-checks only that the account page still exists (404 or 410 fails; other statuses are inconclusive).
