# Deploy runbook

Covers staging and production on Fly.io with Neon Postgres, behind Cloudflare's free plan (spec sections 14 and 14.1). Primary region is `iad`. Nothing here has been deployed yet. Items marked **unconfirmed** were not verified against a source.

## Apps

| App | Fly app name | Config | Command | Public | Health check |
| --- | --- | --- | --- | --- | --- |
| web | `blueyvatar-web` | `fly/web.toml` | `cd apps/web && node_modules/.bin/next start -H 0.0.0.0 -p 3000` | yes, via Cloudflare | `/`, `/api/health` |
| delivery | `blueyvatar-delivery` | `fly/delivery.toml` | `node apps/delivery/dist/server.js` | yes, via Cloudflare | `/healthz`, `/readyz` |
| indexer | `blueyvatar-indexer` | `fly/indexer.toml` | `node apps/indexer/dist/index.js` | no | `/readyz` on 8080 (internal) |
| tap | `blueyvatar-tap` | `fly/tap.toml` | image default | no | `/health` on 2480 |

web, delivery, and indexer build from the root `Dockerfile`, one image holding every app and the migration runner. Each config sets its command with `[experimental] cmd`. References: <https://docs.fly.io/reference/configuration> (build, deploy, http_service, checks, mounts, experimental).

All deploy commands run from the repository root and pass `--dockerfile Dockerfile`, so the build context is the repo root regardless of how flyctl resolves `build.dockerfile`.

## Neon

1. Create one Neon project with two branches: `production` (the default branch) and `staging`. Branch from production for staging, or keep staging empty and migrate it.
2. Each branch has two connection strings on the same database:
   - **Pooled** (hostname contains `-pooler`): `DATABASE_URL`, used by delivery, indexer, and web.
   - **Direct** (no `-pooler`): `DATABASE_URL_DIRECT`, used only by migrations.
3. Why: the pooled endpoint is PgBouncer in transaction mode, which does not support session-level advisory locks, and Neon recommends the direct connection for migrations: <https://neon.com/docs/connect/connection-pooling>. The migration runner holds an advisory lock to serialize runs.
4. The runner uses `MIGRATE_DATABASE_URL`, then `DATABASE_URL_DIRECT`, then `DATABASE_URL`. Set `DATABASE_URL_DIRECT` on delivery, since delivery's release command runs the migrations.

## Migrations

The runner in `tools/migrate` applies `db/migrations/*.sql` in filename order, one transaction per file, and records each file in `schema_migrations`. Rerunning applies nothing. The runner removes standalone `BEGIN;` and `COMMIT;` lines from each file because it supplies the transaction.

- `fly/delivery.toml` sets `release_command = "node tools/migrate/dist/cli.js"`. Fly runs it in a temporary machine before the new version starts, and a failure aborts the deploy so the previous version keeps running. Deploy delivery first when a release adds a migration. The CI workflow does.
- To run by hand: `DATABASE_URL_DIRECT=... pnpm db:migrate` from a checkout.
- delivery deletes expired `rate_windows` rows hourly from a timer in the process.


### Stored primary email (migration 0013)

Until 0013 the database held only email hashes. Migration 0013 adds `notice_emails`: one row per account with the primary email encrypted at rest (AES-256-GCM, `v1:` envelope, key derived with HKDF from `TOKEN_ENCRYPTION_KEY`, the same path as OAuth tokens). It exists only to mail revocation notices (re-verification) and to tell a previous owner that an address moved to another account. Pending one-time codes carry the address in the same encrypted form for their 15 minute life, replacing the old plaintext `notify_to` column, which 0013 clears. The row is deleted when the primary changes, is unlinked, or is taken by another account, and when the indexer sees the account deleted. Existing accounts have no row until they verify or link their email again, so they get no notices before that. Rotating `TOKEN_ENCRYPTION_KEY` makes stored addresses unreadable: notices are skipped until users verify again. Set the same key on web and indexer, and never log addresses.

## First-time setup

```sh
# Apps (once per environment)
fly apps create blueyvatar-web
fly apps create blueyvatar-delivery
fly apps create blueyvatar-indexer
fly apps create blueyvatar-tap

# Tap volume, single machine in iad
fly volumes create tap_data --app blueyvatar-tap --region iad --size 10

# Secrets (see the per-app list below; values come from Infisical)
fly secrets set --app blueyvatar-delivery DATABASE_URL=... DATABASE_URL_DIRECT=... ORIGIN_SECRET=... IMG_SIGNING_SECRET=...
fly secrets set --app blueyvatar-tap TAP_ADMIN_PASSWORD=...

# Deploy. Tap first, delivery before web and indexer.
fly deploy --config fly/tap.toml --dockerfile Dockerfile
fly deploy --config fly/delivery.toml --dockerfile Dockerfile
fly deploy --config fly/web.toml --dockerfile Dockerfile
fly deploy --config fly/indexer.toml --dockerfile Dockerfile
```

Create a deploy token for CI: `fly tokens create deploy --app blueyvatar-delivery` (repeat per app, or use an organization token) and store it as the GitHub secret `FLY_API_TOKEN`. **Unconfirmed:** a single app-scoped deploy token only covers one app, so the workflow needs an org-scoped token (`fly tokens create org`) to deploy all three.

## Staging

Staging runs as a second set of Fly apps in the same organization, named `blueyvatar-<app>-staging`. The configs in `fly/` keep the production app names, so staging overrides them on the command line. Staging uses the Neon `staging` branch. Its secrets live in the Infisical `prod` environment under a `STAGING_` prefix (see Infisical secrets).

```sh
fly apps create blueyvatar-tap-staging   # repeat for web, delivery, indexer
fly volumes create tap_data --app blueyvatar-tap-staging --region iad --size 10

fly deploy --config fly/tap.toml --app blueyvatar-tap-staging
fly deploy --config fly/delivery.toml --app blueyvatar-delivery-staging --dockerfile Dockerfile --remote-only
fly deploy --config fly/web.toml --app blueyvatar-web-staging --dockerfile Dockerfile --remote-only
fly deploy --config fly/indexer.toml --app blueyvatar-indexer-staging --dockerfile Dockerfile --remote-only \
  --env TAP_URL=http://blueyvatar-tap-staging.internal:2480
```

The indexer needs the `--env` override because `fly/indexer.toml` points at the production Tap. The CI workflow deploys only the production apps.

## CI deploys

`.github/workflows/deploy.yml` runs on push to `main` and on manual dispatch, but only when the repository variable `FLY_DEPLOY_ENABLED` is `true`. Set it after the first manual deploy has created the apps. It installs flyctl with `superfly/flyctl-actions/setup-flyctl` (<https://github.com/superfly/flyctl-actions>) and deploys delivery, then web, then indexer, using `FLY_API_TOKEN`. Runs queue under `concurrency: deploy-<ref>` and never cancel each other. The flyctl version is `latest`; pin an exact release when you pick one.

**Tap is deployed by hand.** Restarting Tap interrupts the firehose connection, and an image upgrade can force a re-backfill, so someone should watch each Tap deploy. It also changes rarely.

## Tap

Tap is a separate app that the indexer connects to (`TAP_URL`).

- Env names come from Tap's README: <https://github.com/bluesky-social/indigo/blob/main/cmd/tap/README.md>. `fly/tap.toml` sets `TAP_BIND`, `TAP_SIGNAL_COLLECTION` (`com.blueyvatar.profile`), `TAP_COLLECTION_FILTERS` (the seven collections, comma separated: `com.blueyvatar.image,com.blueyvatar.profile,com.blueyvatar.claim,app.bsky.actor.profile,app.bsky.actor.link,org.tangled.actor.profile,sh.tangled.actor.profile`), `TAP_LOG_LEVEL`, and `TAP_DATABASE_URL`. The secret `TAP_ADMIN_PASSWORD` is set with `fly secrets set`. Clients use Basic auth with user `admin`.
- **Pin the image.** `fly/tap.toml` pins `ghcr.io/bluesky-social/indigo/tap` to tag `0.1.10` and digest `sha256:5e20bfe416d29fcd215ed8bf99f10b2ab825a6de4e5599846dd33967ade2abeb`, the highest semver tag in the registry on November 4, 2026 (tag list read anonymously from the registry API). Upgrade by changing the pin in staging, watching for a clean backfill, then promoting.
- **Storage.** The volume `tap_data` mounts at `/data`, so Tap runs as one machine. The README default is `sqlite://./tap.db` and does not say where that lands in the container, so the config sets `sqlite:///data/tap.db`. Confirmed in staging on November 4, 2026: Tap creates `/data/tap.db` (plus `-shm` and `-wal` files) on the `tap_data` volume. The README says `TAP_DATABASE_URL` also accepts a PostgreSQL connection string but gives no example. A Neon database for Tap is an option to test in staging.
- **Private access.** `fly/tap.toml` has no `http_service` and no `services`, so Tap has no public address (<https://docs.fly.io/reference/configuration>). Do not allocate IPs for it. The indexer reaches it over Fly private networking at `http://blueyvatar-tap.internal:2480` (`<app>.internal` resolves to the app's 6PN addresses, <https://docs.fly.io/networking/private-networking>). Flycast (`<app>.flycast`) is the alternative when you want Fly Proxy features such as autostart for internal traffic (<https://docs.fly.io/networking/flycast>), which Tap does not need.
- **Health check.** `fly/tap.toml` uses a TCP check on port 2480. An HTTP check on `/health` returns 401 in Tap 0.1.10 because it requires the admin password (seen in staging on November 4, 2026), and the password cannot be committed in the config.
- **Jetstream fallback.** Tap is in beta. If it fails, switch the indexer to Jetstream (<https://atproto.com/guides/streaming-data>). That needs an indexer change to filter the same collections and does not exist yet.

### Live Tap test

`apps/indexer/src/tap-live.test.ts` runs the indexer path against a real Tap (issue #42). It signs in to a dedicated test account, writes, updates, and deletes records in all seven filtered collections, consumes the events over the `@atproto/tap` channel, runs them through `handleRecord` and `PgIndexWrites` into a throwaway Postgres schema, and asserts the rows. It also asserts that the Tap event `cid` equals the record CID returned by the PDS for every collection (`app.bsky.actor.link` and both Tangled profile NSIDs included, issue #101), that a stored link's strongRef resolves and an outdated ref is dropped, and that every event is acked only after its handler finished. Set `TAP_LIVE_CHECK_STATUS=1` to also deactivate and reactivate the account and check that `repos` follows. It skips with a message in CI because `TAP_LIVE_URL` is unset.

Run it after a staging deploy:

1. Create a throwaway Bluesky account for tests and an app password for it. Do not use a real person's account: the test rewrites `app.bsky.actor.profile/self` and deletes its own records afterward.
2. Stop the staging indexer so it does not compete for events: `fly scale count 0 --app blueyvatar-indexer-staging`. A Tap channel delivers each event to one consumer, and the test acks what it receives. Scale it back to 1 afterward.
3. Make Tap reachable from your machine without a public address: `fly proxy 2480:2480 -a blueyvatar-tap-staging` (Tap has no public IP).
4. Use any Postgres you can create schemas in for `TEST_DATABASE_URL` (a local one is fine; the test creates and drops its own schema). Do not point it at the staging Neon branch.
5. Run:

```sh
export TAP_LIVE_URL=http://localhost:2480
export TAP_LIVE_ADMIN_PASSWORD=...          # STAGING_TAP_ADMIN_PASSWORD from Infisical
export TAP_LIVE_IDENTIFIER=<test handle or DID>
export TAP_LIVE_APP_PASSWORD=<app password>
export TAP_LIVE_PDS_URL=https://bsky.social # PDS of the test account
export TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres
pnpm tap:live                                # tools/tap-live.sh, add TAP_LIVE_CHECK_STATUS=1 for the status step
```

Each wait times out after 90 seconds (`TAP_LIVE_TIMEOUT_MS`). A timeout message lists the events seen for the test DID. The first green run closes #42. To test locally, run the pinned image: `docker run --rm -p 2480:2480 -e TAP_SIGNAL_COLLECTION=com.blueyvatar.profile -e TAP_COLLECTION_FILTERS=<the list in fly/tap.toml> -e TAP_ADMIN_PASSWORD=test ghcr.io/bluesky-social/indigo/tap:0.1.10@sha256:5e20bfe416d29fcd215ed8bf99f10b2ab825a6de4e5599846dd33967ade2abeb`, then use `TAP_LIVE_ADMIN_PASSWORD=test`. A local Tap still needs outbound access to the relay and the test account's PDS. Not yet run against a live Tap as of this writing.

## Cloudflare

DNS and proxy for `blueyvatar.com` on the free plan (spec section 14.1), plus Email Routing (see Email routing below).

1. Add the zone. Point the web hostname and the delivery hostname at their Fly apps with proxied (orange cloud) CNAME records: `blueyvatar-web.fly.dev` and `blueyvatar-delivery.fly.dev`. Set SSL/TLS mode to Full (strict). Approved hostnames: `blueyvatar.com` (web), `img.blueyvatar.com` (delivery), `profiles.blueyvatar.com` (SaaS fallback origin).
2. Fly certificates. Add each hostname to its app: `fly certs add <hostname> --app <app>`, then `fly certs show` to read the records Fly needs. For a Cloudflare-proxied hostname, Fly's docs say to add the `_fly-ownership` TXT record, after which Fly can issue the certificate through the proxy with the HTTP-01 challenge (this can still fail, depending on configuration). If the HTTP-01 challenge is blocked, add the `_acme-challenge` CNAME shown by `fly certs setup` for DNS-01, or import a Cloudflare Origin Certificate. Use Full or Full (strict); Flexible can cause redirect loops. Source: <https://docs.fly.io/networking/custom-domain>.
3. Caching: `/img/*` responses end in `.png`, `.jpeg`, or `.webp` (the path is `/img/{did}/{cid}/{signature}/{size}.{ext}`, signed with `IMG_SIGNING_SECRET`; an unsigned or edited path gets 403 `invalid_signature`) and send `Cache-Control: public, max-age=31536000, immutable`, so the default cache rules cache them. The `/avatar` and `/u` redirects send `private`, so they are not cached. Confirm after deploy with `curl -sI https://<host>/img/...` and check `CF-Cache-Status` goes from `MISS` to `HIT`, and that redirects show no `HIT`. Do not add a Cache Everything rule.
4. delivery sets `TRUST_CLOUDFLARE=true` (in `fly/delivery.toml`) so rate limits read `CF-Connecting-IP`.
5. Origin lockdown (acceptance item in issue 53): `TRUST_CLOUDFLARE=true` makes `CF-Connecting-IP` spoofable by anyone who reaches `blueyvatar-delivery.fly.dev` directly, so the origin rejects requests that skip Cloudflare using a shared secret header. Set `ORIGIN_SECRET` on delivery (generate with `openssl rand -hex 32`, store in Infisical). When it is set, every request except `GET /healthz` and `GET /readyz` must carry `x-origin-auth` with that value, or delivery answers 403 with error code `origin_forbidden`. When it is unset, delivery accepts all requests and logs a startup warning if `TRUST_CLOUDFLARE=true`. Fly's own health checks reach `/healthz` and `/readyz` directly, which the exemption allows. Add the header at the edge:
   1. In the Cloudflare dashboard, select the zone and open Rules, Overview.
   2. Click Create rule, then Request Header Transform Rule (Rules, Transform Rules, Modify Request Header).
   3. Rule name: `Origin auth`. Under When incoming requests match, use a custom filter: Hostname equals the delivery hostname.
   4. Under Modify request header, choose Set static. Header name `x-origin-auth`, Value the same string as `ORIGIN_SECRET`.
   5. Click Deploy. Verify: `curl -s -o /dev/null -w '%{http_code}' https://blueyvatar-delivery.fly.dev/u/x` returns 403, while the same path through the proxied hostname returns normal responses.
   6. To rotate, deploy the new value in the rule and the Fly secret together (`fly secrets set --app blueyvatar-delivery ORIGIN_SECRET=...`); requests fail in between, so do it in a quiet window.

   Findings (checked 2026-11-03): Transform Rules, including request header rules, are available to all plans, with 10 active rules and no regex on Free (<https://developers.cloudflare.com/rules/transform/>). A rule can set a static header; names starting with `cf-` or `x-cf-` are reserved (<https://developers.cloudflare.com/rules/transform/request-header-modification/>). Dashboard steps: <https://developers.cloudflare.com/rules/transform/request-header-modification/create-dashboard/>. Authenticated Origin Pulls is listed as available on Free (<https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/>), but it was not evaluated against Fly's proxy, so the header is used.
6. Cloudflare for SaaS (custom profile domains, Plus plan). Set the fallback origin to the web app's hostname, `profiles.blueyvatar.com`, proxied to `blueyvatar-web.fly.dev`, and give it a Fly certificate (step 2). Set `CF_SAAS_FALLBACK_ORIGIN` to that hostname. See `docs/research/decisions-phase2-v1.md` (Decision 2).
7. Purge token: create an API token with the Cache Purge permission scoped to the zone. Put it in Infisical as `CF_API_TOKEN` and the zone ID as `CF_ZONE_ID`. Purge limits on the Free plan (URL purge up to 100 per request and 800 URLs per second, prefix and hostname purge 5 requests per minute): <https://developers.cloudflare.com/cache/how-to/purge-cache/>. API reference: <https://developers.cloudflare.com/api/resources/cache/methods/purge/>.

## Web rate limits

The web app limits its expensive or abusable actions with fixed windows stored in the `rate_windows` table (the same table delivery uses, keys prefixed `web:`). Counts are shared by every web instance. Keys hold a salted SHA-256 of the IP or DID, never the raw value; the salt is `REPORT_IP_SECRET`, falling back to `SESSION_SECRET`. Expired rows are removed by the delivery cleanup job. Limits live in `BUCKETS` in `apps/web/lib/rate-limit.ts`.

Client IP: the web app reads `CF-Connecting-IP` only when the request carries `x-origin-auth` equal to `ORIGIN_SECRET`. Set `ORIGIN_SECRET` on the web app (the same value the Cloudflare transform rule sends) and add that rule for the web hostname too, in step 5 of the Cloudflare section. Without it the app falls back to `Fly-Client-IP`, which behind Cloudflare is an edge address, so many users would share one IP bucket. `X-Forwarded-For` is never trusted.

When a limit is hit, server actions show "Too many requests. Try again in N minutes." and route handlers answer 429 with `Retry-After` in seconds. If the database check itself fails, the request is allowed and the error is logged.

| Bucket | Counted by | Limit | Window |
| --- | --- | --- | --- |
| `login.ip` (login start) | IP | 20 | 10 min |
| `login.did` (email link OAuth start) | DID | 10 | 10 min |
| `loginFail.ip` (bad handle or failed sign-in start, then lockout) | IP | 10 failures | 15 min |
| `callback.ip` (OAuth and claim callbacks) | IP | 60 | 10 min |
| `import.did`, `import.ip` (avatar import preview and confirm) | DID, IP | 20, 60 | 10 min |
| `claimAdd.did` | DID | 30 | 1 hour |
| `claimVerify.did`, `claimVerify.ip` (verify and re-verify) | DID, IP | 30, 60 | 1 hour |
| `domain.did`, `domain.ip` (add and remove) | DID, IP | 20, 40 | 1 hour |
| `domainRefresh.did` (Cloudflare status poll on the domain page) | DID | 60 | 10 min |
| `upload.did`, `upload.ip` (avatar and gallery uploads) | DID, IP | 30, 90 | 1 hour |
| `key.did`, `key.ip` (create and rotate) | DID, IP | 20, 60 | 1 hour |
| `addEmail.did`, `addEmail.ip` (new codes) | DID, IP | 5, 20 | 1 hour |
| `codeFail.did` (wrong codes across all codes, then lockout) | DID | 10 failures | 1 hour |

The per-code cap of 5 attempts and the 60 second resend gap still apply. Report submissions keep their own limit of 5 per IP per hour.

Per-account caps, enforced on the server: images by plan (Free 3, Plus 20), gallery images (`GALLERY_MAX`), 10 linked emails, 10 profile links, claims (`MAX_CLAIMS`, checked against both the repo and the database), one custom domain, and active keys by tier. Uploads must carry exactly one file of at most 1,000,000 bytes, checked before the file is read, whatever the browser resized. Server actions accept bodies up to 2 MB.
## Email routing

Cloudflare Email Routing (free) forwards domain addresses to a real inbox. It receives and forwards only; it does not send mail.

- Addresses: `security@blueyvatar.com` (the vulnerability contact in `SECURITY.md`) and `alerts@blueyvatar.com`. Each has its own routing rule.
- Destination: `chris@cdaeris.com`. Cloudflare sends a verification email to a new destination address, and rules cannot forward to it until that link is clicked.
- DNS: Email Routing adds the MX records (`route1`, `route2`, `route3.mx.cloudflare.net`), the SPF TXT record `v=spf1 include:_spf.mx.cloudflare.net ~all`, and a DKIM record at `cf2024-1._domainkey`. Do not add other MX records or a second SPF record for the apex; a domain can publish only one SPF record.
- Token: the API token used for setup is in Infisical project `blueyvatar`, environment `dev`, as `Cloudflare Bluey Setup Token`. It needs Zone: Email Routing Rules Edit, Zone: DNS Edit, and Account: Email Routing Addresses Edit. Never commit its value.
- To add an address: `POST /zones/{zone_id}/email/routing/rules` with a `literal` matcher on `to` and a `forward` action. To add a destination: `POST /accounts/{account_id}/email/routing/addresses`. Docs: <https://developers.cloudflare.com/email-routing/>.

## CDN cache warming

After an avatar changes (an image record upsert, or a Bluesky profile change, which also purges), the indexer requests a fixed list of sizes and formats through the public delivery hostname so Cloudflare caches them before the first visitor asks (issue 49, spec sections 4 and 12). It is best-effort: failures are logged and never fail indexing.

- **What is warmed.** Sizes 80, 128, 256, and 512 in PNG, the default format (constants `WARM_SIZES` and `WARM_FORMATS` in `packages/core/src/resolve.ts`). Override per environment with `WARM_SIZES` (comma list of ladder sizes, such as `80,128,256`) and `WARM_FORMATS` (`png`, `jpeg`, `webp`, such as `png,webp`). Invalid entries are dropped. Each size and format is one signed canonical `/img/{did}/{cid}/{sig}/{size}.{ext}` URL, so a warm request caches the same object a real visitor gets.
- **Where it runs.** Warming starts only when `PUBLIC_DELIVERY_URL` and `IMG_SIGNING_SECRET` are set on the indexer. With either unset it does nothing. Restricted avatars use per-caller scoped URLs and are not warmed.
- **No metering.** Set the same random value as `WARM_SECRET` on delivery and indexer (`openssl rand -hex 32`, store in Infisical). The indexer sends it as `x-warm-auth`. Delivery compares it in constant time, the same way as `x-origin-auth`, and a matching request writes no usage meters. `/img` takes no license key and has no per-key or per-IP limit, so warm requests never touch a license meter or a rate limit either way. The header only changes the DID level service counters (`transform`, `bytes_delivered`). Without a secret on delivery the header is ignored. The request still has to carry `x-origin-auth` when `ORIGIN_SECRET` is set, which the Cloudflare transform rule adds at the edge for any request to the delivery hostname, including the indexer's.
- **Rate limits.** `WARM_CONCURRENCY` (default 2) caps in-flight requests across all jobs. `WARM_MAX_PER_MINUTE` (default 120) is a sliding one-minute cap. Requests over the cap are dropped and counted, not queued.
- **Measuring whether it pays off on the free plan.** Each job logs one line, `cache warm {"did":...,"cid":...,"requested":N,"dropped":N,"cacheStatus":{"miss":N,"hit":N,...}}`, built from the `cf-cache-status` of each warm response. A `miss` means the warm request populated the edge (the work warming exists to do). A `hit` means the object was already cached, so that request was wasted. `dynamic` or `none` means the response was not cacheable, which is a configuration bug to fix. To decide:
  1. Run with warming on for a week. Sum `miss`, `hit`, and `requested` from the indexer logs. The hit share of warm requests is the waste rate. A high rate (for example above 50 percent) means purge and upsert events re-warm objects that are still cached, so warm fewer sizes.
  2. Count first-visitor misses that warming did not prevent. In Cloudflare Analytics, Caching, compare the cache hit ratio for `/img/*` with warming on against a week with `PUBLIC_DELIVERY_URL` unset on the indexer. Optionally compare p95 time to first byte for `/img` requests.
  3. Compare cost. Each warm miss costs one origin resize on Fly, plus one Cloudflare request. Free plan Cloudflare has no per-request charge, so the cost is origin CPU and egress. Divide warm misses by the extra visitor hits that landed as cache hits. Keep warming when the hit ratio improves enough to matter and origin resize counts do not rise. Cut `WARM_SIZES` to the sizes visitors actually request (see `transform` counts per size in delivery logs) when most warmed sizes never get a hit.

## Blocking an image

Reports from the public form land in the `reports` table (status `open`). Moderators work them in the web admin page at `/admin` (issue #145). `pnpm ops:block` and `pnpm ops:block-did` still work for emergencies, and they write to the same audit log.

### Web admin page

Admin access is off until both variables are set on the web app, and then `/admin` answers 404 to everyone else.

| Variable | Value |
| --- | --- |
| `ADMIN_DIDS` | DIDs allowed to use `/admin`, separated by commas or spaces. These accounts sign in through the normal atproto login first. |
| `ADMIN_TOTP_SECRET` | Base32 secret for the second factor. Generate one with `openssl rand 20 | base32`, add it to an authenticator app as a manual time-based entry (SHA-1, 6 digits, 30 seconds), and keep it in Infisical. |
| `CF_ZONE_ID`, `CF_API_TOKEN`, `PUBLIC_DELIVERY_URL` | The same values the ops CLI uses. With any of them unset, a block or takedown still takes effect in the database, the page says the cache purge did not run, and you purge `/img/` for the account in Cloudflare yourself. |

Sign in at `/login`, then open `/admin` and enter the six-digit code. The admin session ends after 30 minutes and can be ended earlier from the page. Wrong codes lock the account for 15 minutes after 5 failures. Every action asks for a reason and is recorded in the `admin_actions` table, which the page shows under "Audit log". Run migration 0019 before the first deploy. `/admin` is disallowed in `robots.txt`, answers `X-Robots-Tag: noindex`, and is not listed in the sitemap.

Actions on the page:

- Dismiss a report, or take down the account: this blocks every indexed image, purges the cache, and marks the reports actioned.
- Suspend an account: a reversible hold. Images indexed after the suspension are not blocked until the suspension is renewed. Lifting it restores only the images the suspension blocked.
- Unblock one image, for example after an appeal.

To block one image from a shell, use the steps below. Set `REPORT_IP_SECRET` on the web app so IP hashes for the rate limit use a private salt. With `DATABASE_URL`, `CF_ZONE_ID`, `CF_API_TOKEN`, and `PUBLIC_DELIVERY_URL` set, run `pnpm ops:block -- <did> <cid> --reason "..."`. It upserts the row in `blocked_images`, then purges the prefix `/img/{did}/{cid}/` from Cloudflare (prefix purges share the 5 per minute limit). `pnpm ops:unblock -- <did> <cid>` marks the row `unblocked_at` and purges again. To take down a whole account from a shell, run `pnpm ops:block-did -- <did> --reason "..." --report <id>`. Delivery answers 404 on `/img` and skips the image in `/avatar` and `/u`, whose redirects are not cached.

## Stripe billing

Stripe is the payment processor (issue #67). The web app sells Plus ($9.99 per month, the user plan), Pro ($9 per month), and Business ($49 per month) through Checkout and manages them through the Customer Portal. Until the first four variables below are set, `/account/billing` says billing is unavailable, no Stripe call is made, and `/api/stripe/webhook` answers 503 naming the missing variables. Use a Stripe test-mode account first, then repeat the steps in live mode.

### Environment variables (web app)

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Secret or restricted API key (`sk_...` or `rk_...`). A restricted key needs write on Checkout Sessions, Customer portal sessions, and Customers. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_...`) of the webhook endpoint created in step 5. |
| `STRIPE_PRICE_PRO` | Price id (`price_...`) of the Pro monthly price. |
| `STRIPE_PRICE_BUSINESS` | Price id (`price_...`) of the Business monthly price. |
| `STRIPE_PRICE_PLUS` | Price id (`price_...`) of the Plus monthly price. Optional: with it unset, Plus is not offered and the other tiers work as before. |

Keep them in Infisical and push them with `fly secrets set --app <web app>`. They are never committed. `PUBLIC_URL` must be `https://blueyvatar.com` in production, since Checkout and portal return URLs are built from it.

### Dashboard steps

1. **Products and prices.** Create three products, "blueyvatar Plus", "blueyvatar Pro", and "blueyvatar Business". Give each one recurring monthly price in USD: $9.99 for Plus, $9.00 for Pro, and $49.00 for Business, with tax behavior set to Exclusive (tax is added on top). Copy each price id into `STRIPE_PRICE_PLUS`, `STRIPE_PRICE_PRO`, and `STRIPE_PRICE_BUSINESS`.
2. **Stripe Tax.** Settings, Tax: set the business head office address, add the registrations where tax must be collected, and set the default product tax category to "Software as a service (SaaS)" or the category counsel confirms. Checkout sends `automatic_tax` and collects the billing address and optional tax ID, so tax is computed per customer.
3. **Invoices.** Settings, Billing, Invoices: set the business name, address, support email, and invoice footer, and turn on customer emails for receipts and invoices. Stripe Billing creates an invoice for every subscription payment, with tax shown.
4. **Customer Portal.** Settings, Billing, Customer portal: enable payment method updates, invoice history, and subscription cancellation (at period end). Enable "Customers can switch plans" and add the Pro and Business products so they can switch between each other. Do not group Plus with them, since Plus is a user plan and a person can hold Plus and a developer tier at the same time. Set the business information and the return link to `https://blueyvatar.com/account/billing`. Save the default configuration.
5. **Webhook endpoint.** Developers, Webhooks, Add endpoint with the URL `https://blueyvatar.com/api/stripe/webhook`. Subscribe it to exactly these events and no others: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`. For local testing, run `stripe listen --forward-to localhost:3000/api/stripe/webhook` and use the secret it prints.
6. **Payment retries.** Settings, Billing, Subscriptions and emails: use Smart Retries and email customers about failed payments. Set "If all retries for a payment fail" to cancel the subscription, and keep the retry window within the 7 day grace period below.
7. **Migrations.** Migration 0015 (billing tables and `licenses.grace_ends_at`) and migration 0017 (allows `plus` in `subscriptions.tier`) run with the delivery release command, along with 0016 (`email_links.email_domain`). Deploy delivery first, then web.
8. **Smoke test in test mode.** Subscribe with card 4242 4242 4242 4242, confirm the license shows Pro on `/account/keys`, cancel in the portal, and confirm it returns to Free. Repeat with the Plus price and confirm `/account/billing` shows Plan: Plus and the gallery section on `/account` unlocks. Use card 4000 0000 0000 0341 to see a failed renewal move the license to past due.

### Behavior to know

- **Webhook handling.** The endpoint verifies the signature against the raw request body (a 5 minute timestamp tolerance), then applies the event in one database transaction that also records the event id in `stripe_events`. A redelivery changes nothing. If an event cannot be applied (for example a subscription arrives before its customer is linked), the endpoint answers 500 and Stripe retries. Check Developers, Webhooks, Event deliveries for failures.
- **Tier mapping.** `active` and `trialing` subscriptions give the price's tier. A Plus price gives the Plus user plan and never changes the developer license. `past_due` keeps the tier during the grace period. `unpaid`, `canceled`, `incomplete`, `incomplete_expired`, and `paused` give Free. Enterprise licenses are contracts and billing never changes them. A price id that is not `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`, or `STRIPE_PRICE_PLUS` is ignored.
- **Grace period (proposal for the owner).** `PAST_DUE_GRACE_DAYS` in `packages/core/src/billing.ts` is 7. A license that goes past due keeps its paid tier for 7 days from the first failed payment, then serves at Free limits. Delivery and the dashboard evaluate the expiry on every read, so no webhook is needed. Data, avatars, and profiles are never deleted. The owner has not approved the number yet.
- **Plus.** Plus is $9.99 per month, approved by the owner. A DID has Plus while it holds a Plus subscription that is `active`, `trialing`, or `past_due` inside the same 7 day grace period, or while it is listed in `PLUS_DIDS`. `PLUS_DIDS` stays as a manual grant for testing and gifts and needs no subscription. The web app and delivery both read the subscription, so the gallery, extra avatar slots, and custom domain follow a purchase within a webhook delivery. A person can hold one Plus subscription and one developer subscription at the same time.
- **Overage.** Metered overage is not billed yet. It needs the per-miss cost measured after deploy, then a metered price and usage reporting.

## Verified account providers

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

## Infisical secrets

Infisical stays the secret store. The team uses only the `prod` environment, so staging values sit there with a `STAGING_` prefix (for example `STAGING_DATABASE_URL`) and production values use the plain names from the table below. Staging and production never share a database URL, session secret, origin secret, Tap password, or OAuth key. Push values to Fly with `fly secrets set --app <app>` (or an Infisical sync, steps not verified here). Names match `.env.example`. Non-secret settings live in `fly/*.toml` `[env]`.

| App | Secrets (Fly secrets) |
| --- | --- |
| delivery | `DATABASE_URL` (pooled), `DATABASE_URL_DIRECT` (for the release command), `ORIGIN_SECRET`, `IMG_SIGNING_SECRET`; optional `WARM_SECRET`, `DEFAULT_URL_ALLOWLIST`, `PG_POOL_MAX`, `SENTRY_DSN`, `METRICS_TOKEN` |
| indexer | `DATABASE_URL` (pooled), `TAP_ADMIN_PASSWORD`, `CF_ZONE_ID`, `CF_API_TOKEN`, `PUBLIC_DELIVERY_URL`, `IMG_SIGNING_SECRET` (same value as delivery, for warming and `files` mode purges); re-verification (with `SERVICE_REPO_DID`, `SERVICE_APP_PASSWORD`, `SERVICE_PDS_URL` so revoked attestations are deleted from the service repo, plus `PUBLIC_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, and `TOKEN_ENCRYPTION_KEY` with the same value as web, which decrypts the primary email for revocation notices; without it in production the indexer cannot send them); optional `WARM_SECRET` (same value as delivery), `WARM_SIZES`, `WARM_FORMATS`, `WARM_CONCURRENCY`, `WARM_MAX_PER_MINUTE`, `REVERIFY_INTERVAL_HOURS` (24), `REVERIFY_AFTER_DAYS` (30), `CF_PURGE_MODE`, `PG_POOL_MAX`, `SENTRY_DSN`. `TAP_URL` is set in `fly/indexer.toml` |
| web | `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`; required in production, encrypts OAuth tokens and the stored primary email in Postgres), `OAUTH_PRIVATE_JWK`, `PUBLIC_URL`, `DELIVERY_URL`, optional `OAUTH_USE_PERMISSION_SET` (see Publish the lexicons), `TRUSTED_PDS_HOSTS`, `RESEND_API_KEY`, `EMAIL_FROM`; if enabled: `CF_SAAS_ZONE_ID`, `CF_SAAS_API_TOKEN`, `CF_SAAS_FALLBACK_ORIGIN`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, the provider keys in Verified account providers below, `SERVICE_REPO_DID`, `SERVICE_APP_PASSWORD`, `SERVICE_PDS_URL`; Stripe billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`, optional `STRIPE_PRICE_PLUS` (see Stripe billing); `DATABASE_URL` (pooled) if web reads the database; optional `SENTRY_DSN`, `METRICS_TOKEN` |
| tap | `TAP_ADMIN_PASSWORD` |

`SENTRY_DSN` and `METRICS_TOKEN` are new secrets (see Observability). `SENTRY_DSN` can be the same project DSN on all three apps, since events are tagged with `app`. `METRICS_TOKEN` should differ per app. Staging uses `STAGING_SENTRY_DSN` and `STAGING_METRICS_TOKEN`, ideally pointing at a separate Sentry project or environment. Non-secret tuning values (`LOG_LEVEL`, `READY_TIMEOUT_MS`, `INDEXER_STALL_SECONDS`, `TAP_PROBE_INTERVAL_SECONDS`, `HEALTH_PORT`) are listed in `.env.example` and can go in `fly/*.toml` `[env]`.

`TAP_ADMIN_PASSWORD` is the same value for tap and indexer. Which web variables are required in production was not audited against the code beyond `.env.example`.

## Publish the lexicons

Covers issue #54. Everything below is scripted in `tools/lexicon`; nothing has been published yet, and name clearance is closed (issue #60). The steps need a DNS zone for `blueyvatar.com` and an atproto account, so they run at deploy time. Primary sources: the [Lexicon spec](https://atproto.com/specs/lexicon) (section "Lexicon Publication and Resolution"), the [Permissions spec](https://atproto.com/specs/permission), the [permission sets guide](https://atproto.com/guides/permission-sets), and the [publishing guide](https://atproto.com/guides/publishing-lexicons).

### What gets published

| NSID | Kind | Record key in `com.atproto.lexicon.schema` |
| --- | --- | --- |
| `com.blueyvatar.image` | record | `com.blueyvatar.image` |
| `com.blueyvatar.profile` | record | `com.blueyvatar.profile` |
| `com.blueyvatar.claim` | record | `com.blueyvatar.claim` |
| `com.blueyvatar.attestation` | record (written to the service repo) | `com.blueyvatar.attestation` |
| `com.blueyvatar.authFull` | permission set, write access to image, profile, and claim | `com.blueyvatar.authFull` |

The files under `lexicons/vendor` belong to other authorities (`com.atproto`, `app.bsky`) and are never published from here.

The spec resolves an NSID through its authority, which is every segment except the last, reversed. All five NSIDs share the authority `com.blueyvatar`, so one DNS record covers them: `_lexicon.blueyvatar.com`. The spec says each authority needs its own TXT record and resolvers do not search parent or child names. Adding an NSID under a new group later, such as `com.blueyvatar.sub.thing`, needs `_lexicon.sub.blueyvatar.com`. The dry run prints one line per authority.

### Steps

1. **Pick the publishing account.** Its DID goes into the TXT record, so changing it later means a DNS change and a wait for caches. It can be the service repo account (`SERVICE_REPO_DID`) or a dedicated one. This is an owner decision. Create an app password for it in the account's settings.
2. **Validate and dry run** (no network, no credentials):

   ```sh
   pnpm lexicons:validate
   pnpm lexicons:dry-run
   ```

   The validator runs the reference parser from `@atproto/lexicon`, then checks reference resolution, union targets, record key types, blob `accept` patterns, and the permission-set rules (only `repo` and `rpc`, no wildcards, collections inside the set's namespace and present in this repo, non-empty `collection` arrays, valid `action` values). The dry run prints the records it would write and the TXT line, with a placeholder for the DID.
3. **Publish the records.** Export the variables from Infisical in your shell. Never commit them or put them in `.env.example` with values.

   ```sh
   export LEXICON_PUBLISH_IDENTIFIER=...        # handle or DID
   export LEXICON_PUBLISH_APP_PASSWORD=...      # app password
   export LEXICON_PUBLISH_SERVICE=https://...   # the account's PDS
   pnpm lexicons:publish
   ```

   The script logs in with `com.atproto.server.createSession`, writes each schema with `com.atproto.repo.putRecord` (collection `com.atproto.lexicon.schema`, record key equal to the NSID) to the PDS named in the DID document, and skips records that already match. It prints `created`, `updated`, or `unchanged` per schema, then the exact TXT record. Rerunning is safe.
4. **Create the DNS record** in the `blueyvatar.com` zone: type `TXT`, name `_lexicon` (that is `_lexicon.blueyvatar.com`), value `did=did:plc:...` exactly as printed. The `did=` prefix is part of the value. Use DNS only, since TXT records are not proxied.
5. **Verify** once DNS has propagated:

   ```sh
   LEXICON_PUBLISH_DID=did:plc:... LEXICON_PUBLISH_PDS_URL=https://... pnpm lexicons:verify
   ```

   It checks that the TXT value names the DID and that the PDS serves records identical to the local files. Without `LEXICON_PUBLISH_PDS_URL` it checks DNS only. It exits non-zero on any failure.
6. **Switch the OAuth client.** Only after step 5 passes, set `OAUTH_USE_PERMISSION_SET=true` on the web app (`fly secrets set --app blueyvatar-web OAUTH_USE_PERMISSION_SET=true`; staging first). The client metadata and the sign-in request then ask for `atproto include:com.blueyvatar.authFull blob:image/*` (plus `account:email` while linking an email) in place of the three `repo:` scopes. The flag is read per request, so a restart is enough and no rebuild is needed. Remove the secret to roll back. Test a sign-in on staging before production.
7. **Close issue #54** once sign-in works with the `include:` scope.

### Behavior to know

- The authorization server (the user's PDS) resolves the set when a session starts. If it cannot resolve the set and has no cached copy, the authorization request fails. That is why the flag defaults to off.
- Authorization servers cache sets. The spec recommends 24 hours as the upper bound before a refresh attempt, and a refresh updates the permissions of an existing session when its tokens are renewed.
- Editing the set later (for example adding a record type) is a republish: run step 3 again. Lexicon evolution rules apply: new fields must be optional, and types, required fields, and length limits cannot change after third parties adopt a schema.
- `blob:image/*` and `account:email` cannot go inside a permission set, so they stay in the scope string.
- The attestation schema is published for readers, but users never grant write access to it, because attestations live in the service repo.

### Not answered by the primary sources

- What a resolver does when one `_lexicon` name has more than one `did=` value. The spec does not say. `lexicons:verify` reports it as a failure, and the TXT record should hold a single value.
- Which authorization servers other than the Bluesky PDS implementation support `include:` scopes today. The Permissions spec says authorization servers are expected to resolve sets. No list of supporting servers was found, so confirm with a staging sign-in on the PDS hosts you care about.
- Which login server to use for an app password. This depends on where the account is hosted, so the script requires `LEXICON_PUBLISH_SERVICE` and has no default.
- Whether a PDS validates `com.atproto.lexicon.schema` records on write. The Lexicon spec describes PDS validation as optimistic when a lexicon is unknown, and the script relies on that default.
- The script was tested against stubbed HTTP and DNS only. No live account was available, so the first real publish is its first live run.

## Original blob cache

Delivery keeps recently fetched original images in memory so a burst of resize requests for one image hits the PDS once.

| Variable | Default | Meaning |
| --- | --- | --- |
| `BLOB_CACHE_MB` | `32` | Size cap in megabytes for the in-memory original cache, per process. `0` turns it off. Invalid values fall back to the default. |

Size the cap against the machine memory, since each delivery process holds its own copy. The failing-host skip (30 seconds, up to 256 hosts) and the retry count (2) are fixed in code. Look for `getBlob` log lines with `outcome` values `ok`, `cache_hit`, `not_found`, `server_error`, `timeout`, `network_error`, `negative_cache`, and `invalid_endpoint`.

## Observability

Covers issue #143. Four parts: structured logs, health and readiness, error tracking, and metrics. Everything is off or inert by default, so local development and tests need no setup.

### Logging

Every app writes one JSON object per line to stdout (warn and error go to stderr, which Fly merges). Fields: `level`, `app` (`web`, `delivery`, `indexer`), `msg`, `time`, plus context. The helper is `createLogger` in `packages/core/src/observability`. It scrubs on the way out:

- A `did` field is replaced with `didHash`, the first 16 hex characters of its SHA256. Raw DIDs are not logged. (Some log lines still carry a `cid` or an event id; those are not personal data.)
- Fields whose names look like credentials or email (`authorization`, `x-api-key`, `token`, `cookie`, `password`, `secret`, `jwk`, `signature`, `email`) are replaced with `[redacted]`.
- Inside strings, email addresses become `[email]`, `Bearer` values are masked, and `token=`, `key=`, `sig=` query values are masked.
- Errors are logged as `name` and `message` only, never a stack.

`LOG_LEVEL` (`debug`, `info`, `warn`, `error`; default `info`) sets the minimum level. Delivery logs one `request` line per request with the route pattern (for example `/avatar/:hash`), status, and duration. It never logs the path parameters, query string, or client IP, so no handle, hash, or key reaches the log (spec section 9). Successful `getBlob` lines are `debug`; failures are `warn`. Fly keeps recent logs for `fly logs` only, and any longer retention needs a log shipper (**unconfirmed**, not researched here). The spec requires a short, published retention period for request logs (section 9). Which period to publish is open.

The CLI tools (`pnpm ops:block`) and the browser hovercards script still print plain text on purpose, and the development email sender prints the code to the console when `RESEND_API_KEY` is unset.

### Request ids

Delivery and web give every request an id and return it in the `x-request-id` response header. A well-formed incoming `x-request-id` (8 to 64 characters of letters, digits, `.`, `_`, `-`) is kept, so one id can follow a request across Cloudflare, web, and delivery. Otherwise a UUID is generated. In web the `proxy.ts` handler sets it on pages and API routes alike. The id is in the JSON body (`error.request_id` on delivery, `request_id` on web) for 5xx responses only. Client errors (4xx) stay byte for byte identical across requests, because hash lookups must not reveal whether a link exists (issue 59). The id is in every log line for the request and in the Sentry event tag `request_id`, so a user who quotes it from a 5xx body or header can be traced.

### Health and readiness

| App | Liveness | Readiness | Fly check |
| --- | --- | --- | --- |
| delivery | `GET /healthz` returns `ok` | `GET /readyz` runs `SELECT 1`, 503 `not_ready` on failure or after `READY_TIMEOUT_MS` (default 3000) | both, in `fly/delivery.toml` |
| web | `GET /` | `GET /api/health` runs `SELECT 1` with the same budget | both, in `fly/web.toml` |
| indexer | `GET :8080/healthz` | `GET :8080/readyz`, 503 `stalled` (see below) | `/readyz`, in `fly/indexer.toml` |

Delivery exempts `/healthz` and `/readyz` from the `ORIGIN_SECRET` lock so Fly's checker works. Without `DATABASE_URL` (local dev) readiness answers ok. Neon suspends idle computes, so the first query after idle can be slow: the 3 second budget and the 5 second Fly check timeout leave room for a wake-up, and the first check after a long idle may fail once. Fly marks a machine failing a check as unhealthy and stops routing to it. Do not rely on a restart (not confirmed from the Fly docs for these checks); the alerts below are what tell a human.

**Indexer.** It had no HTTP service. It now runs a small internal HTTP server on port 8080 (`HEALTH_PORT`). `fly/indexer.toml` still has no `[http_service]`, so the port is reachable only by Fly's checker and over private networking. Two signals keep it ready:

- Tap events processed successfully (`lastEventId` is the consumer cursor), and
- a heartbeat: a successful `GET /health` against Tap every `TAP_PROBE_INTERVAL_SECONDS` (default 15), which keeps a quiet but healthy indexer ready.

`/readyz` returns 503 when neither arrived within `INDEXER_STALL_SECONDS` (default 300), or when event handling has been failing without a single success for that long (for example Postgres down while Tap keeps answering). The JSON body shows `lastEventAgeSeconds`, `lastHeartbeatAgeSeconds`, `lastEventId`, and `outboxBuffer`. The cursor lag is the number of events waiting in Tap's outbox, read from `GET /stats/outbox-buffer` (listed in the Tap README). **Unverified:** the README does not show the response shape of that endpoint, so the code takes the first number in the response, and the probe sends the admin password as basic auth the way `@atproto/tap` does. Confirm against staging Tap (`curl -u admin:$TAP_ADMIN_PASSWORD http://blueyvatar-tap.internal:2480/stats/outbox-buffer` from `fly ssh console`) and fix the parser if it reads the wrong field. If the lag gauge stays absent, only the lag gauge is affected; readiness does not depend on it.

### Error tracking

Set `SENTRY_DSN` (a Fly secret) to turn error tracking on. Unset means nothing is sent and nothing is buffered. It accepts any Sentry-compatible DSN (Sentry, GlitchTip, self-hosted). The reporter is a small client in `packages/core` that posts events with the public envelope protocol (<https://develop.sentry.dev/sdk/data-model/envelopes/>) and has no SDK dependency, which keeps the web bundle and the Docker image unchanged. It does not do tracing, sessions, or source map upload. If those are wanted later, swap in `@sentry/node` behind the same `createErrorTracker` interface. **Not tested against a live Sentry project:** tests cover the envelope with a stubbed transport, so send a test error on staging first (for example call a route with a failing dependency) and check it appears.

What is reported: unhandled errors in delivery (`app.onError`), web server errors (`onRequestError` in `apps/web/instrumentation.ts`), the places web logs a failure (`reportError`), indexer event handler failures, Tap channel errors, re-verification failures, Postgres pool errors, and unhandled rejections. Each event carries `app`, `request_id`, a `task` tag, release (`SENTRY_RELEASE`, default `FLY_IMAGE_REF`), and environment (`SENTRY_ENVIRONMENT`, default the Fly app name).

Scrubbing happens before send: header values for `Authorization`, `x-api-key`, `cookie`, and anything with `token`, `secret`, `password`, or `signature` in the name are replaced; query values for `token`, `key`, `sig`, `code` are replaced; emails and `Bearer` values inside messages are masked. The request body is never attached. Events carry no user, IP, or DID.

### Metrics

Chosen: an in-process registry rendered in the Prometheus text format, read by scraping. Reasons: no vendor lock-in, no per-request network cost, and the Sentry metrics API is not part of the Sentry-compatible protocol that other servers implement. The cost is that something must scrape it. Fly's managed Prometheus can scrape `[metrics]` endpoints (<https://fly.io/docs/monitoring/metrics/>), which is not set up here; wiring it is an owner step (add a `[metrics]` section with `port` and `path` to the toml, and a token if needed). Counters reset when a machine restarts, so use `rate()` and `increase()`.

| App | Endpoint | Auth |
| --- | --- | --- |
| delivery | `GET /metrics` | `Authorization: Bearer $METRICS_TOKEN`; 404 when unset |
| web | `GET /api/metrics` | same |
| indexer | `GET :8080/metrics` | none, internal port only |

Delivery series: `delivery_http_requests_total{route,status}` (status class), `delivery_http_request_duration_ms` (histogram by route), `delivery_resolutions_total{route,result}` (avatar and profile, `found` or `miss`), `delivery_blob_cache_hits_total`, `delivery_blob_failures_total{outcome}` (the `getBlob` outcomes `not_found`, `server_error`, `timeout`, `network_error`, `negative_cache`, `invalid_endpoint`), `delivery_transforms_total{format}`, `delivery_rate_limit_rejections_total`, `delivery_postgres_errors_total`, `delivery_readyz_failures_total`.

Indexer series: `indexer_events_total{type,result}`, `indexer_last_event_age_seconds`, `indexer_last_heartbeat_age_seconds`, `indexer_last_event_id`, `indexer_tap_outbox_buffer` (lag), `indexer_ready`, `indexer_postgres_errors_total`.

Web series: `web_stripe_webhook_total{result}` (`ok`, `failed`, `bad_signature`). Web does not export request metrics; use the Fly proxy metrics for its latency and 5xx rate.

### Alert rules

Thresholds are starting points to tune after a week of real traffic. "Page" means a notification to the on-call owner. Rules marked Fly metrics use the Fly proxy series (`fly_edge_http_responses_count`, `fly_edge_http_response_time_seconds`, see <https://fly.io/docs/monitoring/metrics/>) and need no code. The rest use the series above and need the scraping in the Metrics section, or the equivalent Sentry alert.

| Alert | Condition | Source | Severity |
| --- | --- | --- | --- |
| 5xx rate | 5xx responses above 2 percent of requests for 5 minutes, per app | Fly metrics, or `delivery_http_requests_total{status="5xx"}` over total | page |
| p95 latency | delivery p95 above 1 second for 10 minutes on `/avatar/:hash` and `/u/:id`; above 3 seconds on `/img/...` (resizes) | `delivery_http_request_duration_ms` (`histogram_quantile(0.95, ...)`) | warn |
| Indexer stalled | `indexer_ready == 0` for 5 minutes, or the Fly check `indexer_ready` failing | indexer `/readyz`, Fly check status | page |
| Indexer lag | `indexer_tap_outbox_buffer` above 5000 for 10 minutes, or `indexer_last_event_age_seconds` above 900 while the outbox is above 0 | indexer `/metrics` | page |
| Postgres connection errors | `increase(delivery_postgres_errors_total[5m]) + increase(indexer_postgres_errors_total[5m]) > 0`, or `delivery_readyz_failures_total` rising for 3 checks, or a Sentry issue tagged `task:postgres_pool` | metrics, Sentry | page |
| Stripe webhook failures | any `web_stripe_webhook_total{result="failed"}` in 15 minutes, or a Sentry issue titled `stripe webhook failed` (tag `stripe_event_type`); also watch the endpoint in the Stripe dashboard, which retries for up to three days | metrics, Sentry, Stripe | page |
| getBlob failures | `delivery_blob_failures_total` above 5 percent of `delivery_transforms_total` for 10 minutes | delivery metrics | warn |
| Rate-limit spike | `delivery_rate_limit_rejections_total` rate more than 10 times its weekly median | delivery metrics | info |
| Any new Sentry issue | first seen in production | Sentry | notify channel |

### Owner checklist

1. Create a Sentry (or compatible) project, copy its DSN, and `fly secrets set --app <app> SENTRY_DSN=...` on web, delivery, and indexer (staging: its own DSN). Add it to Infisical as `SENTRY_DSN` and `STAGING_SENTRY_DSN`.
2. Generate a metrics token per app (`openssl rand -hex 32`) and set `METRICS_TOKEN` on delivery and web. Store it in Infisical.
3. Create the alerts in the table in Sentry, Grafana, or Fly's managed Prometheus. Nothing is created automatically.
4. After the first deploy, check `curl https://<delivery host>/readyz`, `curl https://<web host>/api/health`, and `fly ssh console --app blueyvatar-indexer -C "node -e \"fetch('http://localhost:8080/readyz').then(r=>r.text()).then(console.log)\""`, and confirm the `outboxBuffer` value in the indexer response is a number.

## Release checklist

1. Merge to `main`. The deploy workflow builds and deploys delivery, web, and indexer.
2. delivery runs pending migrations in the release command, then starts. A failing migration aborts the deploy and leaves the previous version running.
3. Check `/readyz` on delivery, `/api/health` on web, and the indexer's `/readyz` (see Observability), then the indexer logs for a Tap connection (`fly logs --app blueyvatar-indexer`). `/healthz` stays the liveness route.
4. Deploy Tap by hand only when its pin changes.

## Provisioned resources

- Neon project `blueyvatar` (ID `rough-heart-79040132`), region `aws-us-east-1` (N. Virginia, near Fly `iad`), Postgres 16, created November 3, 2026.
  - Branch `production` (default; 0.25 to 1 CU autoscaling, suspends after Neon's default idle period (owner decision: keep suspend on idle)), database `blueyvatar`, role `blueyvatar_app`.
  - Branch `staging` (0.25 to 1 CU, suspends after 5 minutes idle).
  - Connection strings come from the Neon console or API and go into Infisical; they are never committed. The pooled host contains `-pooler`; the direct host (for migrations) is the same host without it.

- Infisical project `blueyvatar` (ID `0851796f-0fa5-4321-9f50-3ae11e821cd9`), environments `dev`, `staging`, `prod`; only `prod` is used. It holds `STAGING_DATABASE_URL`, `STAGING_DATABASE_URL_DIRECT`, `STAGING_ORIGIN_SECRET`, `STAGING_SESSION_SECRET`, `STAGING_TAP_ADMIN_PASSWORD`, `STAGING_OAUTH_PRIVATE_JWK`, plus `RESEND_API_KEY` and `EMAIL_FROM` (shared by both). `RESEND_API_KEY` is the shared platform key also used by Muster CRM and Cadence V2. `EMAIL_FROM` uses `mail.cdaeris.com`, the only domain verified in Resend, until `blueyvatar.com` is verified. Cloudflare values are not set yet.
- Fly staging apps in the `personal` organization, region `iad`, created November 4, 2026: `blueyvatar-tap-staging` (volume `tap_data`, ID `vol_r1jd8enn1q2dj19r`, 10 GB), `blueyvatar-delivery-staging`, `blueyvatar-indexer-staging`, `blueyvatar-web-staging`.
  - Deployed: tap (image `0.1.10`, TCP check passing), delivery (five migrations applied to the Neon `staging` branch; `/healthz` returns 200, a direct hit on `/u/x` returns 403 `origin_forbidden`), indexer (running; Cloudflare purges logged only).
  - Not deployed: web, which waits on the Cloudflare setup and the `TRUSTED_PDS_HOSTS` value.
