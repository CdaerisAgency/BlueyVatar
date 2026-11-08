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

# Tap volume, single machine in iad (1 GB is the smallest size; see Low-resource mode)
fly volumes create tap_data --app blueyvatar-tap --region iad --size 1

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
fly volumes create tap_data --app blueyvatar-tap-staging --region iad --size 1

fly deploy --config fly/tap.toml --app blueyvatar-tap-staging
fly deploy --config fly/delivery.toml --app blueyvatar-delivery-staging --dockerfile Dockerfile --remote-only
fly deploy --config fly/web.toml --app blueyvatar-web-staging --dockerfile Dockerfile --remote-only
fly deploy --config fly/indexer.toml --app blueyvatar-indexer-staging --dockerfile Dockerfile --remote-only \
  --env TAP_URL=http://blueyvatar-tap-staging.internal:2480
```

The indexer needs the `--env` override because `fly/indexer.toml` points at the production Tap. The CI workflow deploys only the production apps.

## CI deploys

`.github/workflows/deploy.yml` runs on push to `main` and on manual dispatch, but only when the repository variable `FLY_DEPLOY_ENABLED` is `true`. Set it after the first manual deploy has created the apps. It installs flyctl with `superfly/flyctl-actions/setup-flyctl` (<https://github.com/superfly/flyctl-actions>) and deploys delivery, then web, then indexer, using `FLY_API_TOKEN`. The job runs only on the owner's CI runner, named by the repository variable `CI_RUNNER`, and has no GitHub-hosted fallback because it holds `FLY_API_TOKEN`. If `CI_RUNNER` is missing, the job fails instead of running elsewhere. Runs queue under `concurrency: deploy-<ref>` and never cancel each other. The flyctl version is `latest`; pin an exact release when you pick one.

**Tap is deployed by hand.** Restarting Tap interrupts the firehose connection, and an image upgrade can force a re-backfill, so someone should watch each Tap deploy. It also changes rarely.

## Deploy from a local clone (localdeploy.bat)

`localdeploy.bat` at the repo root deploys from a Windows machine that has flyctl signed in. It syncs a clone (default `C:\dev\blueyvatar`, cloned if missing) with `origin/main`, stops on uncommitted changes, then deploys delivery, web, and indexer in that order. Delivery goes first because its release command runs the migrations. Tap is not included.

Run it with no options for a menu: staging, production, both, or quit. Production asks for the typed phrase `DEPLOY PRODUCTION`. Each app asks for a Y or N before it deploys.

For a command line or a scheduled run, pass options so it never waits for input:

| Option | Meaning |
| --- | --- |
| `--env staging`, `--env production`, `--env both` | Where to deploy. `both` runs staging first, then production, and stops if staging fails. |
| `--yes` | No prompts. Needs `--env`. |
| `--confirm-production` | Required with `--yes` when production is included. It replaces the typed phrase. |
| `--repo PATH` | Use another clone. |
| `--no-sync` | Skip the fetch and pull and deploy what is checked out. |
| `--no-pause` | Do not wait for a key at the end. |

```
localdeploy.bat --env staging --yes
localdeploy.bat --env both --yes --confirm-production
```

Exit codes: 0 done, 1 failed, 2 bad usage, 3 stopped by the user. Without `--yes`, a failure or a declined step stops the run and later steps do not run. Check each site and `fly status` afterward.

## Tap

Tap is a separate app that the indexer connects to (`TAP_URL`).

- Env names come from Tap's README: <https://github.com/bluesky-social/indigo/blob/main/cmd/tap/README.md>. `fly/tap.toml` sets `TAP_BIND`, `TAP_SIGNAL_COLLECTION` (`com.blueyvatar.profile`), `TAP_COLLECTION_FILTERS` (the seven collections, comma separated: `com.blueyvatar.image,com.blueyvatar.profile,com.blueyvatar.claim,app.bsky.actor.profile,app.bsky.actor.link,org.tangled.actor.profile,sh.tangled.actor.profile`), `TAP_LOG_LEVEL`, and `TAP_DATABASE_URL`. The secret `TAP_ADMIN_PASSWORD` is set with `fly secrets set`. Clients use Basic auth with user `admin`.
- **Pin the image.** `fly/tap.toml` pins `ghcr.io/bluesky-social/indigo/tap` to tag `0.1.10` and digest `sha256:5e20bfe416d29fcd215ed8bf99f10b2ab825a6de4e5599846dd33967ade2abeb`, the highest semver tag in the registry on November 4, 2026 (tag list read anonymously from the registry API). Upgrade by changing the pin in staging, watching for a clean backfill, then promoting.
- **Storage.** The volume `tap_data` mounts at `/data`, so Tap runs as one machine. The README default is `sqlite://./tap.db` and does not say where that lands in the container, so the config sets `sqlite:///data/tap.db`. Confirmed in staging on November 4, 2026: Tap creates `/data/tap.db` (plus `-shm` and `-wal` files) on the `tap_data` volume. The README says `TAP_DATABASE_URL` also accepts a PostgreSQL connection string but gives no example. A Neon database for Tap is an option to test in staging.
- **Private access.** `fly/tap.toml` has no `http_service` and no `services`, so Tap has no public address (<https://docs.fly.io/reference/configuration>). Do not allocate IPs for it. The indexer reaches it over Fly private networking at `http://blueyvatar-tap.internal:2480` (`<app>.internal` resolves to the app's 6PN addresses, <https://docs.fly.io/networking/private-networking>). Flycast (`<app>.flycast`) is the alternative when you want Fly Proxy features such as autostart for internal traffic (<https://docs.fly.io/networking/flycast>), which Tap does not need.
- **Health check.** `fly/tap.toml` uses a TCP check on port 2480. An HTTP check on `/health` returns 401 in Tap 0.1.10 because it requires the admin password (seen in staging on November 4, 2026), and the password cannot be committed in the config.
- **Jetstream fallback.** Tap is in beta. If it fails, switch the indexer to Jetstream (<https://atproto.com/guides/streaming-data>). That needs an indexer change to filter the same collections and does not exist yet.

### Live Tap test

`apps/indexer/src/tap-live.test.ts` runs the indexer path against a real Tap (issue #42). The full description, the self-contained local run (`pnpm tap:live:local`, local PDS and PLC plus the pinned Tap image, no real accounts), the manual GitHub Actions workflow, and what has and has not been verified are in `docs/testing-live-tap-v1.md`. It skips in CI because neither `LIVE_TAP_TEST` nor `TAP_LIVE_URL` is set.

The rest of this section is external mode, against a staging Tap and a test account you own.

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

Each wait times out after 90 seconds (`TAP_LIVE_TIMEOUT_MS`). A timeout message lists the events seen for the test DID. Run with `TAP_LIVE_CHECK_STATUS=1` to include the account status check. The local, self-contained run replaces the `docker run` recipe that used to be here.

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

Per-account caps, enforced on the server: images by plan (Free 3, Plus 20), gallery images (`GALLERY_MAX`), 10 linked emails, 10 profile links, claims (`MAX_CLAIMS`, checked against both the repo and the database), one custom domain, and active keys by tier. Uploads must carry exactly one file of at most 5 MiB (5,242,880 bytes, the reference PDS default), checked before the file is read, whatever the browser resized. An image above 4096 pixels on the long side is downscaled by the web server with sharp if the browser did not already do it (spec section 5). Server actions accept bodies up to 6 MB.
## Email routing

Cloudflare Email Routing (free) forwards domain addresses to a real inbox. It receives and forwards only; it does not send mail.

- Addresses: `security@blueyvatar.com` (the vulnerability contact in `SECURITY.md`), `support@blueyvatar.com` (general help, including the accessibility page), and `alerts@blueyvatar.com`. Each has its own routing rule. The `support@` rule was added and tested on 2026-11-07.
- Destination: `chris@cdaeris.com`. Cloudflare sends a verification email to a new destination address, and rules cannot forward to it until that link is clicked.
- DNS: Email Routing adds the MX records (`route1`, `route2`, `route3.mx.cloudflare.net`), the SPF TXT record `v=spf1 include:_spf.mx.cloudflare.net ~all`, and a DKIM record at `cf2024-1._domainkey`. Do not add other MX records or a second SPF record for the apex; a domain can publish only one SPF record.
- Token: the API token used for setup is in Infisical project `blueyvatar`, environment `prod`, as `Cloudflare Bluey Setup Token`. It needs Zone: Email Routing Rules Edit, Zone: DNS Edit, and Account: Email Routing Addresses Edit. Never commit its value.
- To add an address: `POST /zones/{zone_id}/email/routing/rules` with a `literal` matcher on `to` and a `forward` action. To add a destination: `POST /accounts/{account_id}/email/routing/addresses`. Docs: <https://developers.cloudflare.com/email-routing/>.

## Notification emails

Usage alerts (80 and 100 percent), billing notices (failed payment, grace expiry, cancellation), and key revoked notices are mailed to the account's primary email from `notice_emails` (issue 144). Delivery and web both send through Resend, so set `RESEND_API_KEY`, `EMAIL_FROM`, `PUBLIC_URL`, and `TOKEN_ENCRYPTION_KEY` on both apps. Without a stored address delivery logs the usage alert instead. Owners switch usage and billing messages off at `/account/notifications` (migration 0019); security notices stay on. Grace expiry is mailed when Stripe ends a subscription that was past due, since the license itself drops to Free limits with no event.

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

## Upload screening and atproto labels

Issue #207. Research: `docs/research/moderation-research-v1.md`. NCMEC reporting is on hold until counsel confirms, so nothing here submits a report.

### Environment variables

| Variable | App | Meaning |
| --- | --- | --- |
| `PHOTODNA_ENDPOINT` | web | Full URL of the PhotoDNA Match operation, from the API Management Portal after approval. |
| `PHOTODNA_KEY` | web | Subscription key. Screening is off unless both are set. |
| `SCAN_FAIL_CLOSED` | web | `1` or `true` also blocks uploads when the service is down. Default off. |
| `LABELER_DIDS` | indexer | Comma separated labeler DIDs to follow. Empty means label enforcement is off. |

Matches are always refused. A scanner outage lets the upload through and logs a warning (`upload screening unavailable`), unless `SCAN_FAIL_CLOSED` is set. Pick fail closed if counsel prefers that; the cost is that uploads stop whenever the service is down. The PhotoDNA request and response shapes in `packages/core/src/scanner.ts` are marked unverified: they sit behind the onboarding portal, so compare them with the portal schema once approved.

### Apply for PhotoDNA Cloud Service (owner)

1. Read the terms: <https://www.microsoft.com/en-us/photodna/termsofuse>. Access is for qualified organizations, is vetted by a third party, and is at Microsoft's discretion.
2. Apply from <https://www.microsoft.com/en-us/photodna/cloudservice> (contact page linked from <https://www.microsoft.com/en-us/PhotoDNA/Documentation>).
3. After approval, sign in to the API Management Portal (<https://developer.microsoftmoderator.com/apis>), copy the Match endpoint URL and your subscription key.
4. Set the secrets: `fly secrets set PHOTODNA_ENDPOINT=... PHOTODNA_KEY=... --app blueyvatar-web`. Check that a test upload still works.

### Enable the Cloudflare CSAM Scanning Tool (owner, no code)

In the Cloudflare dashboard: Caching, Configuration, CSAM Scanning Tool, Configure. Add a verified notification email. It scans content served through the cache after first serve, so it backs up the upload check and does not replace it. Docs: <https://developers.cloudflare.com/cache/reference/csam-scanning/>. It sends a daily email and blocks matched URLs; filing reports remains the operator's job.

### Labels

Find a labeler DID from its own profile or its published DID document (a `did:plc` or `did:web` with an `#atproto_labeler` service entry). This repo deliberately does not hardcode one: Bluesky's moderation labeler DID has not been confirmed from an official Bluesky page. Confirm it from Bluesky's own documentation or account before adding it to `LABELER_DIDS`.

The indexer connects to each labeler's `com.atproto.label.subscribeLabels` endpoint, resumes from the cursor stored in `label_cursors`, and stores only the values it enforces in `moderation_labels`. Label signatures are not verified (see `apps/indexer/src/labels.ts`).

- `!takedown`, `!suspend`, `!hide` on an account or record: delivery stops serving it (avatar, gallery, and blob routes), and cached copies are purged.
- `porn`, `sexual`, `nudity`, `graphic-media`: the effective rating rises (x, r, r, pg) and never falls, so rating filters apply.
- A new enforced label adds one open item to `reports` (origin `label`), so it shows in the admin page with the other reports. A negation removes the stored label; the review item is left for an admin to dismiss.

### Upload scan events and the daily digest

`upload_scan_events` holds one row per match or outage: account, service, outcome, flags, time. It holds no image and no hash, and no page reads it. `scanCounts()` in `apps/web/lib/upload-screen.ts` returns the same counts; the indexer's daily moderation digest (see Web admin page) now reads the table directly. The metric `web_upload_screen_total{outcome}` counts the same events.

## Blocking an image

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

## Stripe billing

Stripe is the payment processor (issue #67). The web app sells Plus ($9 per month) and Business ($49 per month) through Checkout. Plus is one combined plan: it replaces the old Plus ($9.99) and Pro ($9) plans, and Pro is no longer sold and manages them through the Customer Portal. Until the first four variables below are set (the secret key, the webhook secret, and the two price ids), `/account/billing` says billing is unavailable, no Stripe call is made, and `/api/stripe/webhook` answers 503 naming the missing variables. Use a Stripe test-mode account first, then repeat the steps in live mode.

### Environment variables (web app)

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Secret or restricted API key (`sk_...` or `rk_...`). A restricted key needs write on Checkout Sessions, Customer portal sessions, Customers, and Subscriptions (plan switching and cancel use the Subscriptions API; confirm the exact permission names in test mode). |
| `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_...`) of the webhook endpoint created in step 5. |
| `STRIPE_PRICE_PLUS` | Price id (`price_...`) of the Plus monthly price ($9). Checkout and plan switching use the first id. To keep existing subscribers on retired prices working, append their ids after a comma (the old $9.99 Plus price and the old $9 Pro price). The webhook maps every listed id to Plus and never errors on them. |
| `STRIPE_PRICE_BUSINESS` | Price id (`price_...`) of the Business monthly price ($49). |
| `STRIPE_ALLOW_PROMO_CODES` | Optional. Set to `true` to show the promotion code box in Checkout. Any other value or unset keeps it hidden. |

Keep them in Infisical and push them with `fly secrets set --app <web app>`. They are never committed. `PUBLIC_URL` must be `https://blueyvatar.com` in production, since Checkout and portal return URLs are built from it.

### Dashboard steps

1. **Products and prices.** Create two products, "blueyvatar Plus" and "blueyvatar Business". Give each one recurring monthly price in USD: $9.00 for Plus and $49.00 for Business, with tax behavior set to Exclusive (tax is added on top). Copy each price id into `STRIPE_PRICE_PLUS` and `STRIPE_PRICE_BUSINESS`. Do not delete or archive the old Plus and Pro prices while people still subscribe to them: list their ids after the new Plus id in `STRIPE_PRICE_PLUS` (comma separated) until those subscribers have moved.
2. **Stripe Tax.** Settings, Tax: set the business head office address, add the registrations where tax must be collected, and set the default product tax category to "Software as a service (SaaS)" or the category counsel confirms. Checkout sends `automatic_tax` and collects the billing address and optional tax ID, so tax is computed per customer.
3. **Invoices.** Settings, Billing, Invoices: set the business name, address, support email, and invoice footer, and turn on customer emails for receipts and invoices. Stripe Billing creates an invoice for every subscription payment, with tax shown.
4. **Customer Portal.** Settings, Billing, Customer portal: enable payment method updates, invoice history, and subscription cancellation (at period end). Plan switching and cancel/resume are also built into `/account/billing`, so the portal is mainly for the card and invoices. Leaving "Customers can switch plans" on for Plus and Business is harmless, since the webhook follows any price change. Set the business information and the return link to `https://blueyvatar.com/account/billing`. Save the default configuration.
5. **Webhook endpoint.** Developers, Webhooks, Add endpoint with the URL `https://blueyvatar.com/api/stripe/webhook`. Subscribe it to exactly these events and no others: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`. For local testing, run `stripe listen --forward-to localhost:3000/api/stripe/webhook` and use the secret it prints.
6. **Payment retries.** Settings, Billing, Subscriptions and emails: use Smart Retries and email customers about failed payments. Set "If all retries for a payment fail" to cancel the subscription, and keep the retry window within the 7 day grace period below.
7. **Migrations.** Migration 0015 (billing tables and `licenses.grace_ends_at`) and migration 0017 (allows `plus` in `subscriptions.tier`) run with the delivery release command, along with 0016 (`email_links.email_domain`). Combining Plus and Pro adds no migration. Deploy delivery first, then web.
8. **Smoke test in test mode.** Subscribe with card 4242 4242 4242 4242, confirm the license shows Tier: plus on `/account/keys`, `/account/billing` shows Plan: Plus, and the gallery section on `/account` unlocks. Cancel in the portal and confirm it returns to Free. Use card 4000 0000 0000 0341 to see a failed renewal move the license to past due.

### Plan changes in the app

`/account/billing` lets a person with a paid plan switch between Plus and Business, cancel, resume, and open the portal for the card and invoices. Switching calls `subscriptions.update` on the one subscription item (never adds a second item), so the renewal date does not change. Sources: https://docs.stripe.com/billing/subscriptions/upgrade-downgrade, https://docs.stripe.com/billing/subscriptions/prorations, https://docs.stripe.com/api/subscriptions/update, https://docs.stripe.com/billing/subscriptions/cancel.

- **Higher price** (by the prices in `apps/web/lib/pricing.ts`, so Plus to Business is higher): `proration_behavior: always_invoice`, which charges the difference now.
- **Lower price** (Business to Plus): `create_prorations`, which adds a credit to the next invoice. Stripe does not refund prorations automatically. Whether the credit shows tax is Unknown (the Stripe pages say only that tax on prorations is covered in the Stripe Tax variant of "Collect taxes for recurring payments"); check one downgrade invoice in test mode.
- **Failed charge:** `payment_behavior: error_if_incomplete`, so a declined card returns an error and the plan is unchanged. This does not support cards that need 3D Secure; those people see the "not changed" message and can use Manage billing. Unknown: whether `pending_if_incomplete` supports these updates with Stripe Tax, so it is not used.
- **Not allowed in the app:** switching while a payment is past due (Stripe may credit unpaid time), while the subscription is set to end (resume first), and for Enterprise licenses and organization licenses (organization billing stays in the portal).
- **Cancel and resume:** `cancel_at_period_end` true or false. Resume works until the period ends; a subscription that has ended cannot be reactivated, so the person subscribes again.
- **Database:** nothing changes until the webhook arrives. The same events as before carry the new price, `cancel_at_period_end`, and status, so no migration or new event is needed.

### Stripe setup checklist

Do these in test mode first, then live mode. Never commit keys, price ids, or promotion codes.

1. Products and prices (USD, monthly, tax behavior Exclusive): two products, "blueyvatar Plus" $9.00 and "blueyvatar Business" $49.00. Keep the old Plus and Pro prices active until their subscribers have moved.
2. Environment variables on the web app (Infisical `prod`, `STAGING_` prefix for staging, then `fly secrets set`): `STRIPE_SECRET_KEY` (a restricted key also needs Subscriptions write), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PLUS` (new $9 price id first, then optionally the retired Plus and Pro price ids, comma separated), `STRIPE_PRICE_BUSINESS`. Delete `STRIPE_PRICE_PRO` if it is set. Optional: `STRIPE_ALLOW_PROMO_CODES=true` on staging only. `PUBLIC_URL=https://blueyvatar.com`.
3. Webhook endpoint `https://blueyvatar.com/api/stripe/webhook` (and the staging URL with test mode) subscribed to exactly: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
4. Customer portal settings: payment method update on, invoice history on, cancel subscription on with "at end of billing period", return link `https://blueyvatar.com/account/billing`. Switch plan is optional (Plus and Business only).
5. Billing settings: Smart Retries on, customer emails for failed payments on, and when all retries fail, cancel the subscription, with the retry window inside 7 days.
6. Stripe Tax, invoice branding, and the support email, as in the Dashboard steps above.
7. Test in test mode: subscribe with Plus; switch to Business (card charged the difference); switch back (credit on the next invoice); cancel and confirm "Ends on" shows; resume; confirm card 4000 0000 0000 0341 on a switch shows the "not changed" message; confirm a failed renewal shows the grace notice.

### Testing with a free coupon

1. In Stripe test mode, open Product catalog, Coupons, and create a coupon with 100% off.
2. Choose a duration: "Once" covers the first invoice only, "Forever" covers every renewal.
3. Under redemption limits, set a maximum number of redemptions, for example 5.
4. Set a redeem-by date so the coupon expires on its own.
5. Open the coupon and create a promotion code for it. Optionally limit it to first-time customers.
6. Set `STRIPE_ALLOW_PROMO_CODES=true` on the web app. Checkout now shows the promotion code box.
7. Subscribe with the code, then unset the variable (or set it to `false`) when testing is done.

### Behavior to know

- **Webhook handling.** The endpoint verifies the signature against the raw request body (a 5 minute timestamp tolerance), then applies the event in one database transaction that also records the event id in `stripe_events`. A redelivery changes nothing. If an event cannot be applied (for example a subscription arrives before its customer is linked), the endpoint answers 500 and Stripe retries. Check Developers, Webhooks, Event deliveries for failures.
- **Tier mapping.** `active` and `trialing` subscriptions give the price's tier. A Plus price gives the Plus license tier and the Plus user plan; a Business price gives the Business license tier and also the Plus user plan for the person's own account. `past_due` keeps the tier during the grace period. `unpaid`, `canceled`, `incomplete`, `incomplete_expired`, and `paused` give Free. Enterprise licenses are contracts and billing never changes them. A price id that is not listed in `STRIPE_PRICE_PLUS` or `STRIPE_PRICE_BUSINESS` is ignored, unless the subscription is already stored, in which case the event still updates it under its stored plan so a cancellation is never lost. Rows and licenses that hold the retired plan name `pro` are read as Plus everywhere (web, delivery, indexer, webhook); no data is rewritten, and new Plus licenses are stored as `pro` in `licenses.tier` because that column's check constraint predates Plus.
- **Grace period (proposal for the owner).** `PAST_DUE_GRACE_DAYS` in `packages/core/src/billing.ts` is 7. A license that goes past due keeps its paid tier for 7 days from the first failed payment, then serves at Free limits. Delivery and the dashboard evaluate the expiry on every read, so no webhook is needed. Data, avatars, and profiles are never deleted. The owner has not approved the number yet.
- **Plus.** Plus is $9 per month, approved by the owner, and combines the old Plus and Pro plans. A DID has Plus while it holds a Plus subscription, or a Business subscription on its own license, that is `active`, `trialing`, or `past_due` inside the same 7 day grace period, or while it is listed in `PLUS_DIDS`. `PLUS_DIDS` stays as a manual grant for testing and gifts and needs no subscription. The web app and delivery both read the subscription, so the gallery, extra avatar slots, and custom domain follow a purchase within a webhook delivery. A license holds one subscription at a time.
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
| delivery | `DATABASE_URL` (pooled), `DATABASE_URL_DIRECT` (for the release command), `ORIGIN_SECRET`, `IMG_SIGNING_SECRET`; optional `WARM_SECRET`, `DEFAULT_URL_ALLOWLIST`, `PG_POOL_MAX`, `IMG_MAX_CONCURRENT`, `IMG_QUEUE_MAX`, `IMG_QUEUE_WAIT_MS`, `RATE_BATCH_MS`, `SENTRY_DSN`, `METRICS_TOKEN` |
| indexer | `DATABASE_URL` (pooled), `TAP_ADMIN_PASSWORD`, `CF_ZONE_ID`, `CF_API_TOKEN`, `PUBLIC_DELIVERY_URL`, `IMG_SIGNING_SECRET` (same value as delivery, for warming and `files` mode purges); moderation digest (optional `MODERATION_DIGEST_TO`, `MODERATION_DIGEST_HOUR_UTC`, `MODERATION_DIGEST_ALWAYS`, `MODERATION_SLA_HOURS`; `ADMIN_DIDS` as the default recipient source); re-verification (with `SERVICE_REPO_DID`, `SERVICE_APP_PASSWORD`, `SERVICE_PDS_URL` so revoked attestations are deleted from the service repo, plus `PUBLIC_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, and `TOKEN_ENCRYPTION_KEY` with the same value as web, which decrypts the primary email for revocation notices; without it in production the indexer cannot send them); optional `WARM_SECRET` (same value as delivery), `WARM_SIZES`, `WARM_FORMATS`, `WARM_CONCURRENCY`, `WARM_MAX_PER_MINUTE`, `REVERIFY_INTERVAL_HOURS` (24), `REVERIFY_AFTER_DAYS` (30), `CF_PURGE_MODE`, `PG_POOL_MAX`, `SENTRY_DSN`. `TAP_URL` is set in `fly/indexer.toml` |
| web | `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`; required in production, encrypts OAuth tokens and the stored primary email in Postgres), `OAUTH_PRIVATE_JWK`, `PUBLIC_URL`, `DELIVERY_URL`, optional `OAUTH_USE_PERMISSION_SET` (see Publish the lexicons), optional `OAUTH_REQUEST_BSKY_PROFILE` (see Bluesky avatar permission), `TRUSTED_PDS_HOSTS`, `ADMIN_DIDS` and `ADMIN_TOTP_SECRET` (review portal; see Web admin page), optional `MODERATION_SLA_HOURS`, `MODERATION_POLICIES`, `MODERATION_CHILD_SAFETY_DIDS`, `RESEND_API_KEY`, `EMAIL_FROM`; if enabled: `CF_SAAS_ZONE_ID`, `CF_SAAS_API_TOKEN`, `CF_SAAS_FALLBACK_ORIGIN`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, the provider keys in Verified account providers below, `SERVICE_REPO_DID`, `SERVICE_APP_PASSWORD`, `SERVICE_PDS_URL`; Stripe billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`, optional `STRIPE_PRICE_PLUS` (see Stripe billing); `DATABASE_URL` (pooled) if web reads the database; to purge cached images when a user deletes their data (issue #140): `CF_ZONE_ID`, `CF_API_TOKEN`, and `PUBLIC_DELIVERY_URL` (same values as the indexer, prefix purge only); optional `SENTRY_DSN`, `METRICS_TOKEN` |
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

   The validator runs the reference parser from `@atproto/lexicon`, then checks reference resolution, union targets, record key types, blob `accept` patterns, and the permission-set rules (only `repo` and `rpc`, no wildcards, collections inside the set's namespace and present in this repo, non-empty `collection` arrays, valid `action` values). The dry run also checks each planned record (`com.atproto.lexicon.schema` shape, record key equal to the NSID, `com.blueyvatar.authFull` included), then prints the exact `putRecord` body for each schema and the TXT line, with a placeholder for the DID unless `LEXICON_PUBLISH_DID` is set. The same checks run before a real publish.
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
| delivery | `GET /healthz` returns `ok` | `GET /readyz` runs `SELECT 1`, 503 `not_ready` on failure or after `READY_TIMEOUT_MS` (default 3000) | `/healthz` only, in `fly/delivery.toml` (low-resource mode) |
| web | `GET /` | `GET /api/health` runs `SELECT 1` with the same budget | `/` only, in `fly/web.toml` (low-resource mode) |
| indexer | `GET :8080/healthz` | `GET :8080/readyz`, 503 `stalled` (see below) | `/readyz`, in `fly/indexer.toml` |

Delivery exempts `/healthz` and `/readyz` from the `ORIGIN_SECRET` lock so Fly's checker and outside monitors work. The readiness routes are not Fly checks in low-resource mode (see Low-resource mode); call them by hand or from an uptime monitor. Without `DATABASE_URL` (local dev) readiness answers ok. Neon suspends idle computes, so the first query after idle can be slow: the 3 second budget and the 5 second Fly check timeout leave room for a wake-up, and the first check after a long idle may fail once. Fly marks a machine failing a check as unhealthy and stops routing to it. Do not rely on a restart (not confirmed from the Fly docs for these checks); the alerts below are what tell a human.

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

Delivery series: `delivery_http_requests_total{route,status}` (status class), `delivery_http_request_duration_ms` (histogram by route), `delivery_resolutions_total{route,result}` (avatar and profile, `found` or `miss`), `delivery_blob_cache_hits_total`, `delivery_blob_failures_total{outcome}` (the `getBlob` outcomes `not_found`, `server_error`, `timeout`, `network_error`, `negative_cache`, `invalid_endpoint`), `delivery_transforms_total{format}`, `delivery_transforms_in_flight` (gauge, resize workers running), `delivery_transforms_queued` (gauge, jobs waiting for a slot), `delivery_transforms_shed_total` (jobs answered 503), `delivery_rate_limit_rejections_total`, `delivery_postgres_errors_total`, `delivery_readyz_failures_total`.

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

### Service status (outside Fly)

Issue 179. The owner chose to watch blueyvatar from the Cdaeris uptime dashboard (`CdaerisAgency/uptime`, Gatus, `uptime.cdaeris.com`, internal) instead of a separate status page. Design and open items: `docs/research/status-page-v1.md`.

| Gatus row | Probe | Green means |
| --- | --- | --- |
| `web /api/health` | `GET https://blueyvatar.com/api/health`, body `status` is `ok`, every 4 hours | web serves through Cloudflare and ran `SELECT 1` |
| `delivery /readyz` | `GET https://img.blueyvatar.com/readyz`, body `status` is `ready`, every 4 hours | delivery serves through Cloudflare and its Postgres check passed |
| `delivery /healthz` | `GET https://img.blueyvatar.com/healthz` returns 200, every 4 hours | the delivery process answers |

The rows ship disabled and need `enabled: true` after the first production deploy. They send no secret, because delivery exempts `/healthz` and `/readyz` from the origin lock. At 4 hours this is a slow second opinion from outside Fly. The alert rules above are the fast signal. During an incident, read the rows together: `/healthz` red means the process is down, `/healthz` green with `/readyz` red means the database check failed, and web red with delivery green points at the web app. There is no public status page yet, so tell affected Pro and Business developers by email from `alerts@blueyvatar.com`.

### Owner checklist

1. Create a Sentry (or compatible) project, copy its DSN, and `fly secrets set --app <app> SENTRY_DSN=...` on web, delivery, and indexer (staging: its own DSN). Add it to Infisical as `SENTRY_DSN` and `STAGING_SENTRY_DSN`.
2. Generate a metrics token per app (`openssl rand -hex 32`) and set `METRICS_TOKEN` on delivery and web. Store it in Infisical.
3. Create the alerts in the table in Sentry, Grafana, or Fly's managed Prometheus. Nothing is created automatically.
4. After the first deploy, check `curl https://<delivery host>/readyz`, `curl https://<web host>/api/health`, and `fly ssh console --app blueyvatar-indexer -C "node -e \"fetch('http://localhost:8080/readyz').then(r=>r.text()).then(console.log)\""`, and confirm the `outboxBuffer` value in the indexer response is a number.
5. After the first production deploy, set `enabled: true` on the three blueyvatar rows in `CdaerisAgency/uptime` `config.yaml` and redeploy that dashboard, and confirm the Trigger.dev watchdog alert exists there (see Service status above).

## Log retention

Policy (issue #146, owner decision): logs are kept 90 days or until a size cap is reached, whichever comes first. The same sentence is published on `/privacy`. This section covers request logs, logs held in our own database, and the settings that make every store agree.

### Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOG_RETENTION_DAYS` | `90` | Age limit in days. Values above 90 are clamped to 90, because 90 is the published ceiling. Lower it only if you also change `/privacy`. |
| `LOG_RETENTION_MAX_GB` | `5` | Size cap in gigabytes, applied to each log store separately (the log destination and the database). Invalid values fall back to the default. |

Both are read by delivery, which runs the database purge. Set them as Fly secrets or in `fly/delivery.toml` `[env]`. The log destination has its own settings, listed below, and must be set to the same two numbers by hand.

### Why 5 GB

No traffic data exists yet (spec section 11 calls its numbers placeholders), so the default comes from arithmetic on what the code logs. Delivery writes one JSON line per request with level, app, message, time, route pattern, status, duration, and request id (see Observability, Logging). That is about 250 to 350 bytes, so call it 300 bytes with shipper metadata. Cloudflare caches `/img/*` and serves the rate limit and redirect traffic from the edge only on hits, so the origin sees a fraction of all requests.

| Origin requests per day | Lines in 90 days | Size in 90 days at 300 bytes |
| --- | --- | --- |
| 10,000 | 0.9 million | 0.3 GB |
| 100,000 | 9 million | 2.7 GB |
| 185,000 | 16.7 million | 5 GB |
| 1,000,000 | 90 million | 27 GB |

A 5 GB cap therefore never bites below about 185,000 origin requests per day, so at launch volumes the 90 day limit is the one that applies, and the cap is a guard against a traffic spike or a log-spam bug filling the destination. Above that volume the cap wins and older lines drop earlier than 90 days, which the policy allows. The figure is also small enough to fit common free or low cost tiers of log destinations (confirm against the vendor, see below). Revisit it after the first month of real traffic: multiply the daily line count by 300 bytes and by 90.

### Database-held logs

Delivery runs `enforceLogRetention` (`apps/delivery/src/log-retention.ts`) a minute after start and then daily:

- `reports.ip_hash` is set to NULL once a report is older than the age limit. The report row stays, because it records a takedown decision and holds no request data. The hash only drives the per-IP report rate limit, which looks back far less than 90 days. Migration 0020 drops the NOT NULL constraint for this.
- `stripe_events` rows (processed webhook event ids) older than the age limit are deleted. Stripe stops retrying a webhook within days, so a 90 day idempotency window is ample.
- Size cap: if the live bytes of those two (event rows plus kept IP hashes) exceed `LOG_RETENTION_MAX_GB`, the oldest rows across both go first, in batches of 1,000, until the total fits.
- `profile_view_counters` (issue #173, migration 0025) holds one row per DID per UTC day with two counters: `views` (non-bot renders of `/p/{handle}`, written by web) and `json_calls` (keyed `/profile/{id}` calls, written by delivery next to the `profile_json` meter). It stores no IP address, user agent, or cookie. Rows from days before the age limit are deleted, and the rows count toward the size cap (oldest first). The age limit is the same 90 days, not a separate period, so `/privacy` states one number. Plus members read the last 30 days at `/account/stats`; the rows are in the account data export and removed by account deletion.
- `rate_windows` is already cleaned hourly by `rate-cleanup.ts` once its window ends (minutes), well inside the policy.
- Not logs, so not purged here: `usage_alerts`, `usage_counters`, and `service_usage_counters` (billing and quota accounting, one row per period), and `oauth_state` and `email_codes` rows that expire in minutes.

Check a run in the delivery logs for `log retention purge` (printed only when something was removed). A purge failure logs `log retention purge failed` and retries the next day.

### Fly and external log retention

Fly keeps logs only briefly for `fly logs`; the exact window is **unconfirmed** (not stated in the Fly docs we have read), so treat it as shorter than 90 days and never as the record of retention. Nothing is shipped yet. Until a destination is set up, request logs live only in Fly's short buffer, which is within the policy (shorter than 90 days) but gives no look-back for abuse investigations. To meet the policy with look-back, ship logs and set the destination as follows. Vendor details below are **unconfirmed**: verify each on the vendor's current docs and record the date when you do.

1. Ship with Fly's log shipper, an app that reads Fly's NATS log stream and forwards it: <https://github.com/superfly/fly-log-shipper>. Run it as its own Fly app with a read-only org token. It supports several sinks (Axiom, Loki, Datadog, and others, per its README).
2. At the destination, set retention to 90 days and a 5 GB (or `LOG_RETENTION_MAX_GB`) cap:
   - Grafana Loki: `retention_period: 2160h` (90 days) with the compactor's `retention_enabled: true`. Loki has no total size cap setting that we have confirmed, so watch storage and lower `retention_period` if needed, or use a destination below.
   - Axiom: set the dataset retention to 90 days in the dataset settings. A size cap is not a dataset setting we have confirmed; the plan's ingest limit is the practical cap.
   - Any other sink: both a 90 day expiry and a size limit must exist, or a scheduled job must enforce them. If a sink cannot, do not choose it.
3. Cost at expected volume: at the table above, 0.3 to 2.7 GB per 90 days is within free tiers at several vendors, but plan limits change and are **unconfirmed** here. Owner action: confirm the plan and that a paid destination is acceptable (the issue asked).
4. Logs must never carry client IPs, query strings, cookies, keys, or raw DIDs, because the logger removes them before they reach any sink (Observability, Logging). Per request, a shipped line holds timestamp, route pattern, status, duration, and request id. The key id and a user agent length class from the issue's field list are not logged; that is stricter than required.

## Publish the npm packages

Two public packages ship from `packages/`: `@blueyvatar/avatar` (URL builder, hashing, Gravatar migration helper, React component) and `@blueyvatar/hovercards`. Neither is published yet. The workflow `.github/workflows/publish-npm.yml` runs only when a version tag such as `v0.1.0` is pushed, and it publishes with npm provenance. It fails before publishing if the `NPM_TOKEN` secret is missing.

### One-time setup (owner)

1. Create the `blueyvatar` organization on npmjs.com (owner decision on issue #153). Packages under the `@blueyvatar` scope are public, so the free plan is enough.
2. Create a granular access token on npmjs.com with read and write access to the `@blueyvatar` packages, and an expiry you will track. Store it in Infisical as `NPM_TOKEN`.
3. Add the same value as the GitHub repository secret `NPM_TOKEN` (Settings, Secrets and variables, Actions). Infisical stays the source of truth. Whether an Infisical to GitHub sync is set up here was not verified.
4. Provenance needs a public source repository when npm verifies the build. The repository is private today (see docs/licensing-v1.md), and npm rejects `--provenance` from a private repository. Make the repository public first, or remove `--provenance` from the workflow and from `publishConfig` in `packages/avatar/package.json` for a private-repo publish. This was not tested here.

### Release steps

1. Set `version` in the `package.json` of each package to release (`packages/avatar`, `packages/hovercards`) and merge to `main`. On the first release, also remove the "not published yet" status line from each package README.
2. Run locally as a dry run: `pnpm --filter @blueyvatar/avatar build && cd packages/avatar && npm pack --dry-run`. Confirm only `dist` and `README.md` are listed.
3. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`. The tag must equal the package version with a leading `v`. A package whose version differs from the tag is skipped, and the run fails if no package matches.
4. Watch the "Publish npm packages" run. Then check the package page shows the provenance badge.
5. A published version cannot be replaced. To fix a bad release, publish a new version and run `npm deprecate` on the bad one.

The versioning policy is in `packages/avatar/README.md`.

## Release checklist

1. Merge to `main`. The deploy workflow builds and deploys delivery, web, and indexer.
2. delivery runs pending migrations in the release command, then starts. A failing migration aborts the deploy and leaves the previous version running.
3. Check `/readyz` on delivery, `/api/health` on web, and the indexer's `/readyz` (see Observability), then the indexer logs for a Tap connection (`fly logs --app blueyvatar-indexer`). `/healthz` stays the liveness route.
4. Deploy Tap by hand only when its pin changes.
5. Log retention: confirm `LOG_RETENTION_MAX_GB` (default 5) and `LOG_RETENTION_DAYS` (default 90) match the log destination's settings, and that `/privacy` still says 90 days or the size cap, whichever comes first (see Log retention).

## Low-resource mode

Owner decision, November 7, 2026: "because we have no user adoption right now, all services, fly, neon, etc, should be configured for the lowest resource use and uptime acceptable." The configs in `fly/` and this runbook implement it. Raise the numbers in "Scaling up later" when traffic or paid users arrive.

### Fly sizes

| App | VM | Machines | Scale to zero | Why this size |
| --- | --- | --- | --- | --- |
| web | `shared-cpu-1x`, 512 MB | 1, region `iad` only | yes | A local `next start` of the production build used about 178 MB peak resident memory after 60 requests with no database attached (measured November 7, 2026). That leaves too little headroom for a 256 MB VM once Postgres, OAuth, and image uploads are in play. Not measured on Fly. |
| delivery | `shared-cpu-1x`, 512 MB | 1, region `iad` only | yes | Each resize forks a worker process with a 256 MB heap cap (`apps/delivery/src/resize.ts`, `maxOldSpaceMb`) beside the parent, which also holds a 32 MB original cache (`BLOB_CACHE_MB`). Concurrent resizes are capped at 2 (see Resize concurrency cap below). Memory per worker is measured locally, not on Fly. |
| indexer | `shared-cpu-1x`, 256 MB | exactly 1 | no | A Node process with a small Postgres pool (`PG_POOL_MAX`, default 5). Not measured on Fly; the first out-of-memory kill in `fly logs` means move to 512 MB. |
| tap | `shared-cpu-1x`, 512 MB | exactly 1 | no | The Tap README states no memory requirement. It does say the outbox buffers up to 1M pending events in memory and the identity cache defaults to 2,000,000 entries (`TAP_IDENT_CACHE_SIZE`). Treat 512 MB as a starting point and try 256 MB in staging first. **Unconfirmed.** |

Sizes in `fly/*.toml` come from the `[[vm]]` section (<https://docs.fly.io/reference/configuration>). Fly's pricing page lists `shared-cpu-1x` at 256 MB, 512 MB, and 1 GB (<https://docs.fly.io/about/pricing>), so 256 MB is the smallest size we found a price for. The pricing page also says a stopped Machine is not charged for CPU or RAM, only its root file system.

### Scale to zero (web and delivery)

Both apps set `auto_stop_machines = "stop"`, `auto_start_machines = true`, and `min_machines_running = 0`. Fly documents these as follows (<https://docs.fly.io/launch/autostop-autostart>): `auto_stop_machines` accepts `"off"`, `"stop"`, or `"suspend"`; Fly Proxy stops Machines when the app has been idle for several minutes; `min_machines_running` keeps that many Machines running in the primary region and has no effect unless autostop is `"stop"` or `"suspend"`. The proxy runs its check every few minutes, and with a single Machine it stops it when there is no traffic (<https://docs.fly.io/reference/fly-proxy-autostop-autostart.md>). The first request after a stop starts the Machine, so expect a cold start. Fly publishes no latency figure. The same page warns that for a short time after a start, requests can fail until all proxy nodes know the Machine is running. A visitor can therefore see one error right after a long idle.

`"suspend"` is the other documented option. Fly does not say how it differs from `"stop"` in startup speed, so the configs use `"stop"`. **Unconfirmed:** whether `"suspend"` would be faster.

**Health checks.** Fly's docs do not say whether HTTP check requests count as traffic for autostop (the autostop and health check pages are silent on it), so this is **unconfirmed**. To avoid depending on it, each scaled-to-zero app has one liveness check on a 60 second interval, and the Fly checks no longer include the readiness routes (`/readyz` on delivery, `/api/health` on web). Those routes run `SELECT 1`, so a check on them every interval would wake the Neon compute for as long as the machine runs. Use them from a manual call or an uptime monitor with a long interval. If a Machine never stops on its own after a deploy, suspect the Fly check first and try removing it.

The delivery `release_command` still runs the migrations on each deploy, which wakes Neon once per deploy.

### Resize concurrency cap (delivery)

Every cold `/img` variant, `/default` avatar, and QR PNG forks one sharp worker. The local load test (`docs/research/load-test-v1.md`) measured about 65 to 70 MB resident per worker, and an uncapped run reached 37 workers (2.5 GB) at 50 rps and 88 workers (6.3 GB) at 200 rps. On the 512 MB VM that would be an out-of-memory kill, so delivery caps the number of workers at once (`limitedResizer` in `apps/delivery/src/resize.ts`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `IMG_MAX_CONCURRENT` | `2` | Resize workers running at once. |
| `IMG_QUEUE_MAX` | `8` | Jobs allowed to wait for a slot. A request past this is shed at once. |
| `IMG_QUEUE_WAIT_MS` | `3000` | Longest a job waits for a slot before it is shed. |
| `RATE_BATCH_MS` | `1000` | Flush period for the in-memory rate-window and usage counters (see below). `0` writes through on every request. |

The web app reads the same three variables for the server-side upload downscale (issue #203), with its own defaults of `1`, `4`, and `5000`.

Sizing for 512 MB: the Node parent measured 92 to 272 MB resident in the local runs (the 32 MB blob cache included), which leaves about 240 MB. Two workers at 65 to 70 MB is 130 to 140 MB, with the rest as headroom for a larger source image (the worker accepts up to 40 megapixels, which decodes to far more than a 1024 px avatar) and for the OS. Three would fit a typical avatar and not a large one, so the default is 2. Not measured on Fly: if `fly logs` shows no out-of-memory kills under a burst of cold variants, raise it; on a 1 GB VM use 4. A shed request gets `503` with `Retry-After: 2`, `Cache-Control: no-store`, and error code `overloaded`, so Cloudflare does not cache it and the client retries.

Sharp's own settings follow the cap: each worker runs `sharp.concurrency(1)` and `sharp.cache(false)`, so total sharp threads equal the cap and no libvips cache accumulates. On a 1 vCPU shared machine a higher per-worker thread count would only add contention.

**Batched counters.** Rate windows and usage counters are counted in memory and flushed to Postgres every `RATE_BATCH_MS`. The first hit on a key or a new window still writes through. With several machines each one sees the others' counts only at its flush, so a limit can be overshot by up to (machines x requests per interval), and a hard kill loses at most one interval of increments (SIGTERM and SIGINT flush first). Because delivery scales to zero, a one second interval also means Neon is touched at most once a second per active key instead of once per request.

### Indexer and Tap cannot scale to zero

The indexer holds a live connection to Tap, and Tap holds the live firehose connection. Stopping either one stops event intake, so both stay at one always-on machine with no autostop (Fly's default for `auto_stop_machines` is `"off"`). Tap is also tied to one machine by its volume.

What happens if they are down anyway (for example a crash, a deploy, or a manual stop): the Tap README says Tap saves its firehose cursor (every 1 second by default, `TAP_CURSOR_SAVE_INTERVAL`) and resumes from it on restart, which "can mean replaying millions of events", and that "any repos that changed while offline will be detected and resynced automatically" (<https://github.com/bluesky-social/indigo/blob/main/cmd/tap/README.md>). It also says events are delivered at least once, and repos that fell behind resync when their next firehose event arrives. So short outages are caught up from the cursor. The README does not state how long a cursor stays valid at the upstream relay, so a long outage is **unconfirmed**. Do not plan on stopping Tap for days. The tradeoff we accept: roughly two always-on 256 to 512 MB machines instead of zero, because missed or very late profile and image events are worse than the small cost.

### Tap volume

`tap_data` is 1 GB, the default and the smallest whole-gigabyte size `fly volumes create --size` takes (<https://docs.fly.io/flyctl/volumes-create/>; no minimum is documented, and the flag is an integer). The Tap README gives no disk size guidance, so the right size is unknown (**unconfirmed**). This deployment tracks only accounts that have a `com.blueyvatar.profile` record (`TAP_SIGNAL_COLLECTION`), which keeps the database small at launch volumes, but that is our expectation, not a measurement. Fly bills the full provisioned size ($0.15 per GB per month, <https://docs.fly.io/about/pricing>). Volumes can be extended but not shrunk (<https://docs.fly.io/volumes/overview>), so starting small is the safe direction. Watch usage with `fly ssh console --app blueyvatar-tap -C "df -h /data"` and extend before it passes about 70 percent (see "Extend a volume" in <https://docs.fly.io/volumes/volume-manage>).

### Neon

Set both branch computes to the minimum size and the shortest scale-to-zero delay the plan allows. Neon's docs say:

- The smallest size is 0.25 CU, and autoscaling supports 0.25 to 16 CU (<https://neon.com/docs/manage/computes>). Set autoscaling minimum and maximum both to 0.25 CU on production and staging for the lowest resource use, or keep a maximum of 1 CU if you want headroom for a traffic burst.
- Scale to zero defaults to 300 seconds (5 minutes). On the Free plan it is fixed at 5 minutes and cannot be changed or disabled. On the Launch plan it is 5 minutes and can be disabled. On the Scale plan it can be set from 60 seconds to one week. Initial configuration is only supported through the Neon API (`suspend_timeout_seconds`), after which the console control appears (<https://neon.com/docs/guides/scale-to-zero-guide>).
- A suspended compute reactivates "within a few hundred milliseconds" on the next query (<https://neon.com/docs/introduction/scale-to-zero>).

The owner already chose suspend-on-idle for production, and staging suspends after 5 minutes. So: on the Scale plan set 60 seconds on both branches; on Free or Launch leave the 5 minute default. Do not run keepalive pings.

What still touches Neon (these are the only in-app jobs that do):

| Job | Where | Interval | Notes |
| --- | --- | --- | --- |
| Rate window cleanup | delivery (`apps/delivery/src/rate-cleanup.ts`) | daily (was hourly) | Expired rows reset on next use, so cleanup only reclaims space. |
| Log retention purge | delivery (`apps/delivery/src/log-retention.ts`) | 60 seconds after start, then daily | Runs on every wake of a scaled-to-zero machine. If delivery gets no traffic, it does not run, so rows older than the 90 day retention can stay until the next wake. |
| Billing retention purge | indexer (`apps/indexer/src/billing-retention.ts`) | at start, then daily | Already daily. |
| Claim re-verification | indexer (`REVERIFY_INTERVAL_HOURS`) | 24 hours | Already daily. |
| Index writes | indexer | per Tap event | The indexer writes when Tap delivers an event for a tracked account, so Neon wakes on that traffic. Cannot be deferred without losing the live stream. |
| Page polling | web, `/account/domain` (`PollRefresh.tsx`) | 15 seconds while that page is open in a browser | Only while a user watches the page. |
| Fly health checks | all apps | 60 seconds | None of them query Postgres now. |

The indexer also probes Tap's `/health` every `TAP_PROBE_INTERVAL_SECONDS` (15), which does not touch Neon.

### Staging

Staging uses the same configs, so it has the same sizes. Keep it stopped when unused: `fly machine stop <id> --app blueyvatar-<app>-staging` for each app, with the id from `fly machine list --app blueyvatar-<app>-staging`. Delivery and web also stop themselves when idle. Start them again with `fly machine start` before testing, Tap first. Staging Tap on a stopped machine is not receiving events, so start it a while before you test event flow. The staging volume is still billed while stopped. Recreate it at 1 GB (it was created at 10 GB): `fly volumes destroy`, then `fly volumes create tap_data --app blueyvatar-tap-staging --region iad --size 1`.

### Scaling up later

- More memory: `fly scale memory 1024 --app blueyvatar-<app>` for a one-off, or change `memory` in the `[[vm]]` section of `fly/<app>.toml` (a deploy resets manual `fly scale vm` changes to the file, per the configuration reference).
- Always warm web or delivery: set `min_machines_running = 1`, or `auto_stop_machines = "off"`, in `fly/web.toml` or `fly/delivery.toml`, and add the readiness check back (`/readyz`, `/api/health`).
- More machines or regions: `fly scale count 2`, or add regions; keep Tap at one machine.
- Bigger Tap volume: extend it (volumes cannot shrink).
- Neon: raise the autoscaling maximum, disable scale to zero (Launch plan or higher), or raise the minimum CU.
- Rate window cleanup: pass a shorter interval to `scheduleRateWindowCleanup` in `apps/delivery/src/server.ts`.

### Cost

No cost estimate is given here beyond Fly's published list prices: a continuously running `shared-cpu-1x` is $3.69 per month at 512 MB and $2.19 per month at 256 MB, and a 1 GB volume is $0.15 per month (<https://docs.fly.io/about/pricing>). Stopped Machines pay only for their root file system. Neon plan prices are not quoted here.

## Provisioned resources

- Neon project `blueyvatar` (ID `rough-heart-79040132`), region `aws-us-east-1` (N. Virginia, near Fly `iad`), Postgres 16, created November 3, 2026.
  - Branch `production` (default; 0.25 to 1 CU autoscaling, suspends after Neon's default idle period (owner decision: keep suspend on idle)), database `blueyvatar`, role `blueyvatar_app`.
  - Branch `staging` (0.25 to 1 CU, suspends after 5 minutes idle).
  - Connection strings come from the Neon console or API and go into Infisical; they are never committed. The pooled host contains `-pooler`; the direct host (for migrations) is the same host without it.

- Infisical project `blueyvatar` (ID `0851796f-0fa5-4321-9f50-3ae11e821cd9`), environments `dev`, `staging`, `prod`; only `prod` is used. It holds `STAGING_DATABASE_URL`, `STAGING_DATABASE_URL_DIRECT`, `STAGING_ORIGIN_SECRET`, `STAGING_SESSION_SECRET`, `STAGING_TAP_ADMIN_PASSWORD`, `STAGING_OAUTH_PRIVATE_JWK`, plus `RESEND_API_KEY` and `EMAIL_FROM` (shared by both). `RESEND_API_KEY` is the shared platform key also used by Muster CRM and Cadence V2. `EMAIL_FROM` uses `mail.cdaeris.com`, the only domain verified in Resend, until `blueyvatar.com` is verified. Cloudflare values are not set yet.
- Fly staging apps in the `personal` organization, region `iad`, created November 4, 2026: `blueyvatar-tap-staging` (volume `tap_data`, ID `vol_r1jd8enn1q2dj19r`, 10 GB as created; volumes cannot shrink, so recreate it at 1 GB to match low-resource mode), `blueyvatar-delivery-staging`, `blueyvatar-indexer-staging`, `blueyvatar-web-staging`.
  - Deployed: tap (image `0.1.10`, TCP check passing), delivery (five migrations applied to the Neon `staging` branch; `/healthz` returns 200, a direct hit on `/u/x` returns 403 `origin_forbidden`), indexer (running; Cloudflare purges logged only).
  - Not deployed: web, which waits on the Cloudflare setup and the `TRUSTED_PDS_HOSTS` value.

## Account data deletion and billing retention

Signed-in users can download their data and delete it at `/account/data`. Deletion removes everything except Stripe billing rows (`billing_customers`, `subscriptions`), which are marked `deleted_at` and kept for 7 years for tax and accounting. It cancels active Stripe subscriptions first, so `STRIPE_SECRET_KEY` must be set on web for that step. The indexer runs a daily job (`apps/indexer/src/billing-retention.ts`) that deletes billing rows 7 years after `deleted_at`, and `stripe_events` rows 7 years after they were processed (they hold no DID). Email hashes stay as 30-day holds, as for any deleted account.

## Profile avatar permission

Letting users change their profile avatar from blueyvatar needs one more sign-in scope, `repo:app.bsky.actor.profile?action=update` (issue #241, spec section 10.1). It is behind `OAUTH_REQUEST_BSKY_PROFILE`, which is off by default, because the permission spec does not say whether Bluesky's authorization server lets a third-party app request write access to an `app.bsky.*` collection. A refused scope would break sign-in for everyone.

| Setting | Where | Notes |
| --- | --- | --- |
| `OAUTH_REQUEST_BSKY_PROFILE` | web app secret (Infisical, then Fly) | `true` or `1` turns the scope on. Unset or anything else leaves it off. Read per request, so a restart is enough and no rebuild is needed. Remove it to roll back. |

Turn it on in this order:

1. Set it on staging only, with the staging web app's secrets.
2. Sign in on staging with the owner's account. Confirm the consent screen lists the Bluesky profile permission and the sign-in succeeds.
3. On the Avatars page, use "Use as my avatar on <server name>" on a G image, confirm the picture changes on the profile and the rest of the profile is unchanged, then use "Restore my previous avatar". Repeat once with an account hosted on a non-Bluesky server.
4. Also test an account with no profile record yet. The code never creates the record and tells the user to save their profile once in an app that uses it, so confirm that message appears. If Bluesky requires `create` for that case, the scope needs `action=create` added and this page updated.
5. Only after steps 2 to 4 pass, set it on production. Existing users see "Sign in again to allow this" until their next sign-in.

The migration `db/migrations/0033_bsky_avatar_sync.sql` adds the per-account switch, the saved previous avatar, and an insert-only log of every change to a Bluesky profile.
