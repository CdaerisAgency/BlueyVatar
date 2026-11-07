# Deploy runbook

Covers staging and production on Fly.io with Neon Postgres, behind Cloudflare's free plan (spec sections 14 and 14.1). Primary region is `iad`. Nothing here has been deployed yet. Items marked **unconfirmed** were not verified against a source.

## Apps

| App | Fly app name | Config | Command | Public | Health check |
| --- | --- | --- | --- | --- | --- |
| web | `blueyvatar-web` | `fly/web.toml` | `cd apps/web && node_modules/.bin/next start -H 0.0.0.0 -p 3000` | yes, via Cloudflare | `/` |
| delivery | `blueyvatar-delivery` | `fly/delivery.toml` | `node apps/delivery/dist/server.js` | yes, via Cloudflare | `/healthz` |
| indexer | `blueyvatar-indexer` | `fly/indexer.toml` | `node apps/indexer/dist/index.js` | no | none (no HTTP server) |
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

- Env names come from Tap's README: <https://github.com/bluesky-social/indigo/blob/main/cmd/tap/README.md>. `fly/tap.toml` sets `TAP_BIND`, `TAP_SIGNAL_COLLECTION` (`com.blueyvatar.profile`), `TAP_COLLECTION_FILTERS` (the five collections, comma separated), `TAP_LOG_LEVEL`, and `TAP_DATABASE_URL`. The secret `TAP_ADMIN_PASSWORD` is set with `fly secrets set`. Clients use Basic auth with user `admin`.
- **Pin the image.** `fly/tap.toml` pins `ghcr.io/bluesky-social/indigo/tap` to tag `0.1.10` and digest `sha256:5e20bfe416d29fcd215ed8bf99f10b2ab825a6de4e5599846dd33967ade2abeb`, the highest semver tag in the registry on November 4, 2026 (tag list read anonymously from the registry API). Upgrade by changing the pin in staging, watching for a clean backfill, then promoting.
- **Storage.** The volume `tap_data` mounts at `/data`, so Tap runs as one machine. The README default is `sqlite://./tap.db` and does not say where that lands in the container, so the config sets `sqlite:///data/tap.db`. Confirmed in staging on November 4, 2026: Tap creates `/data/tap.db` (plus `-shm` and `-wal` files) on the `tap_data` volume. The README says `TAP_DATABASE_URL` also accepts a PostgreSQL connection string but gives no example. A Neon database for Tap is an option to test in staging.
- **Private access.** `fly/tap.toml` has no `http_service` and no `services`, so Tap has no public address (<https://docs.fly.io/reference/configuration>). Do not allocate IPs for it. The indexer reaches it over Fly private networking at `http://blueyvatar-tap.internal:2480` (`<app>.internal` resolves to the app's 6PN addresses, <https://docs.fly.io/networking/private-networking>). Flycast (`<app>.flycast`) is the alternative when you want Fly Proxy features such as autostart for internal traffic (<https://docs.fly.io/networking/flycast>), which Tap does not need.
- **Health check.** `fly/tap.toml` uses a TCP check on port 2480. An HTTP check on `/health` returns 401 in Tap 0.1.10 because it requires the admin password (seen in staging on November 4, 2026), and the password cannot be committed in the config.
- **Jetstream fallback.** Tap is in beta. If it fails, switch the indexer to Jetstream (<https://atproto.com/guides/streaming-data>). That needs an indexer change to filter the same collections and does not exist yet.

## Cloudflare

DNS and proxy for `blueyvatar.com` on the free plan (spec section 14.1). Nothing else from Cloudflare is used.

1. Add the zone. Point the web hostname and the delivery hostname at their Fly apps with proxied (orange cloud) CNAME records: `blueyvatar-web.fly.dev` and `blueyvatar-delivery.fly.dev`. Set SSL/TLS mode to Full (strict). Exact record names depend on how web and delivery are split across hostnames and are not decided.
2. Fly certificates. Add each hostname to its app: `fly certs add <hostname> --app <app>`, then `fly certs show` to read the records Fly needs. For a Cloudflare-proxied hostname, Fly's docs say to add the `_fly-ownership` TXT record, after which Fly can issue the certificate through the proxy with the HTTP-01 challenge (this can still fail, depending on configuration). If the HTTP-01 challenge is blocked, add the `_acme-challenge` CNAME shown by `fly certs setup` for DNS-01, or import a Cloudflare Origin Certificate. Use Full or Full (strict); Flexible can cause redirect loops. Source: <https://docs.fly.io/networking/custom-domain>.
3. Caching: `/img/*` responses end in `.png`, `.jpeg`, or `.webp` (the path is `/img/{did}/{cid}/{signature}/{size}.{ext}`, signed with `IMG_SIGNING_SECRET`; an unsigned or edited path gets 403 `invalid_signature`) and send `Cache-Control: public, max-age=31536000, immutable`, so the default cache rules cache them. The `/avatar` and `/u` redirects send `private`, so they are not cached. Confirm after deploy with `curl -sI https://<host>/img/...` and check `CF-Cache-Status` goes from `MISS` to `HIT`, and that redirects show no `HIT`. Do not add a Cache Everything rule.
4. delivery sets `TRUST_CLOUDFLARE=true` (in `fly/delivery.toml`) so rate limits read `CF-Connecting-IP`.
5. Origin lockdown (acceptance item in issue 53): `TRUST_CLOUDFLARE=true` makes `CF-Connecting-IP` spoofable by anyone who reaches `blueyvatar-delivery.fly.dev` directly, so the origin rejects requests that skip Cloudflare using a shared secret header. Set `ORIGIN_SECRET` on delivery (generate with `openssl rand -hex 32`, store in Infisical). When it is set, every request except `GET /healthz` must carry `x-origin-auth` with that value, or delivery answers 403 with error code `origin_forbidden`. When it is unset, delivery accepts all requests and logs a startup warning if `TRUST_CLOUDFLARE=true`. Fly's own health checks reach `/healthz` directly, which the exemption allows. Add the header at the edge:
   1. In the Cloudflare dashboard, select the zone and open Rules, Overview.
   2. Click Create rule, then Request Header Transform Rule (Rules, Transform Rules, Modify Request Header).
   3. Rule name: `Origin auth`. Under When incoming requests match, use a custom filter: Hostname equals the delivery hostname.
   4. Under Modify request header, choose Set static. Header name `x-origin-auth`, Value the same string as `ORIGIN_SECRET`.
   5. Click Deploy. Verify: `curl -s -o /dev/null -w '%{http_code}' https://blueyvatar-delivery.fly.dev/u/x` returns 403, while the same path through the proxied hostname returns normal responses.
   6. To rotate, deploy the new value in the rule and the Fly secret together (`fly secrets set --app blueyvatar-delivery ORIGIN_SECRET=...`); requests fail in between, so do it in a quiet window.

   Findings (checked 2026-11-03): Transform Rules, including request header rules, are available to all plans, with 10 active rules and no regex on Free (<https://developers.cloudflare.com/rules/transform/>). A rule can set a static header; names starting with `cf-` or `x-cf-` are reserved (<https://developers.cloudflare.com/rules/transform/request-header-modification/>). Dashboard steps: <https://developers.cloudflare.com/rules/transform/request-header-modification/create-dashboard/>. Authenticated Origin Pulls is listed as available on Free (<https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/>), but it was not evaluated against Fly's proxy, so the header is used.
6. Cloudflare for SaaS (custom profile domains, Plus plan). Set the fallback origin to the web app's hostname, for example `profiles.blueyvatar.com`, proxied to `blueyvatar-web.fly.dev`, and give it a Fly certificate (step 2). Set `CF_SAAS_FALLBACK_ORIGIN` to that hostname. See `docs/research/decisions-phase2-v1.md` (Decision 2).
7. Purge token: create an API token with the Cache Purge permission scoped to the zone. Put it in Infisical as `CF_API_TOKEN` and the zone ID as `CF_ZONE_ID`. Purge limits on the Free plan (URL purge up to 100 per request and 800 URLs per second, prefix and hostname purge 5 requests per minute): <https://developers.cloudflare.com/cache/how-to/purge-cache/>. API reference: <https://developers.cloudflare.com/api/resources/cache/methods/purge/>.

## Blocking an image

Reports from the public form land in the `reports` table (status `open`). Review them with SQL, for example `SELECT id, target_did, reason, details, created_at FROM reports WHERE status = 'open' ORDER BY created_at`. Set `REPORT_IP_SECRET` on the web app so IP hashes for the rate limit use a private salt. To take down a reported account, run `pnpm ops:block-did -- <did> --reason "..." --report <id>`; it blocks all of the account's images, purges them, and records who and why on the report. To block one image, use the steps below. With `DATABASE_URL`, `CF_ZONE_ID`, `CF_API_TOKEN`, and `PUBLIC_DELIVERY_URL` set, run `pnpm ops:block -- <did> <cid> --reason "..."`. It upserts the row in `blocked_images`, then purges the prefix `/img/{did}/{cid}/` from Cloudflare (prefix purges share the 5 per minute limit). `pnpm ops:unblock -- <did> <cid>` marks the row `unblocked_at` and purges again. Delivery answers 404 on `/img` and skips the image in `/avatar` and `/u`, whose redirects are not cached.

## Infisical secrets

Infisical stays the secret store. The team uses only the `prod` environment, so staging values sit there with a `STAGING_` prefix (for example `STAGING_DATABASE_URL`) and production values use the plain names from the table below. Staging and production never share a database URL, session secret, origin secret, Tap password, or OAuth key. Push values to Fly with `fly secrets set --app <app>` (or an Infisical sync, steps not verified here). Names match `.env.example`. Non-secret settings live in `fly/*.toml` `[env]`.

| App | Secrets (Fly secrets) |
| --- | --- |
| delivery | `DATABASE_URL` (pooled), `DATABASE_URL_DIRECT` (for the release command), `ORIGIN_SECRET`, `IMG_SIGNING_SECRET`; optional `DEFAULT_URL_ALLOWLIST`, `PG_POOL_MAX` |
| indexer | `DATABASE_URL` (pooled), `TAP_ADMIN_PASSWORD`, `CF_ZONE_ID`, `CF_API_TOKEN`, `PUBLIC_DELIVERY_URL`, `IMG_SIGNING_SECRET` (same value as delivery, for warming and `files` mode purges); re-verification (with `SERVICE_REPO_DID`, `SERVICE_APP_PASSWORD`, `SERVICE_PDS_URL` so revoked attestations are deleted from the service repo, plus `PUBLIC_URL`, `RESEND_API_KEY`, `EMAIL_FROM`); optional `REVERIFY_INTERVAL_HOURS` (24), `REVERIFY_AFTER_DAYS` (30), `CF_PURGE_MODE`, `PG_POOL_MAX`. `TAP_URL` is set in `fly/indexer.toml` |
| web | `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`; required in production, encrypts OAuth tokens in Postgres), `OAUTH_PRIVATE_JWK`, `PUBLIC_URL`, `DELIVERY_URL`, `TRUSTED_PDS_HOSTS`, `RESEND_API_KEY`, `EMAIL_FROM`; if enabled: `CF_SAAS_ZONE_ID`, `CF_SAAS_API_TOKEN`, `CF_SAAS_FALLBACK_ORIGIN`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SERVICE_REPO_DID`, `SERVICE_APP_PASSWORD`, `SERVICE_PDS_URL`; `DATABASE_URL` (pooled) if web reads the database |
| tap | `TAP_ADMIN_PASSWORD` |

`TAP_ADMIN_PASSWORD` is the same value for tap and indexer. Which web variables are required in production was not audited against the code beyond `.env.example`.

## Logging

Fly keeps recent logs for `fly logs` only, and any longer retention needs a log shipper (**unconfirmed**, not researched here). The spec requires a short, published retention period for request logs (section 9). Which period to publish is open.

## Release checklist

1. Merge to `main`. The deploy workflow builds and deploys delivery, web, and indexer.
2. delivery runs pending migrations in the release command, then starts. A failing migration aborts the deploy and leaves the previous version running.
3. Check `/healthz` on delivery, the web home page, and the indexer logs for a Tap connection (`fly logs --app blueyvatar-indexer`).
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
