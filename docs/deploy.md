# Deploy runbook

Covers staging and production on Railway behind Cloudflare's free plan (spec sections 14 and 14.1). Nothing here has been deployed yet. Items marked **unconfirmed** were not verified against a source.

## Services

| Service | Source | Start command | Config file | Health check |
| --- | --- | --- | --- | --- |
| `web` | this repo | `cd apps/web && node_modules/.bin/next start` | `/railway/web.json` | `/` |
| `delivery` | this repo | `node apps/delivery/dist/server.js` | `/railway/delivery.json` | `/healthz` |
| `indexer` | this repo | `node apps/indexer/dist/index.js` | `/railway/indexer.json` | none (no HTTP server) |
| `tap` | Docker image | image default | none | `/health` on port 2480 |
| `postgres` | Railway Postgres (or Neon) | | | |

All three repo services build from the root `Dockerfile`, a single image holding every app and the migration runner. Each service leaves Root Directory unset (shared monorepo) and sets **Railway Config File** to the absolute path above. Per Railway's monorepo guide the config file path does not follow Root Directory, so use the absolute form: <https://docs.railway.com/deployments/monorepo>.

**Config as Code is deprecated.** Railway's page says existing `railway.json` files keep working for legacy services until 2026-12-01, and that Infrastructure as Code (`.railway/railway.ts`) replaces it: <https://docs.railway.com/reference/config-as-code> and <https://docs.railway.com/infrastructure-as-code>. New services cannot opt into Config as Code. The files in `railway/` use the documented keys (`build.builder`, `build.dockerfilePath`, `build.watchPatterns`, `deploy.startCommand`, `deploy.preDeployCommand`, `deploy.healthcheckPath`, `deploy.restartPolicyType`), so if they are not read, enter the same values in each service's Settings page. Porting to Infrastructure as Code is a follow-up. I could not confirm which build and deploy fields that format supports.

Create environments `staging` and `production`, each with its own set of services and its own Infisical environment.

## Postgres and migrations

1. Add the Railway Postgres plugin (or a Neon project) per environment. Give `delivery` and `indexer` its connection string as `DATABASE_URL`.
2. Migrations run through the in-repo runner in `tools/migrate`. It applies `db/migrations/*.sql` in filename order, one transaction per file, and records each file in `schema_migrations`. Rerunning applies nothing. A Postgres advisory lock serializes concurrent runs. The runner removes standalone `BEGIN;` and `COMMIT;` lines from each file because it supplies the transaction.
3. The `delivery` service runs the runner as its `preDeployCommand`, so pending migrations apply before the new version starts. `indexer` and `web` do not run migrations. Deploy `delivery` first when a release adds a migration.
4. To run by hand: `DATABASE_URL=... pnpm db:migrate` from a checkout (it builds the runner first).
5. `delivery` deletes expired `rate_windows` rows hourly from a timer in the process.

## Tap

Tap is a separate service that the indexer connects to (`TAP_URL`).

- Quick start for Railway, linked from the atproto self-hosting guide (<https://atproto.com/guides/self-hosting>): <https://github.com/bluesky-social/indigo/blob/main/cmd/tap/RAILWAY_DEPLOY.md>. It uses the image `ghcr.io/bluesky-social/indigo/tap:latest`, a volume at `/data`, port `2480`, and the variables `TAP_LOG_LEVEL` and `TAP_ADMIN_PASSWORD`.
- Environment names come from Tap's README: <https://github.com/bluesky-social/indigo/blob/main/cmd/tap/README.md>.

| Variable | Value for blueyvatar | Source |
| --- | --- | --- |
| `TAP_SIGNAL_COLLECTION` | `com.blueyvatar.profile` | Tap README |
| `TAP_COLLECTION_FILTERS` | `com.blueyvatar.image,com.blueyvatar.profile,com.blueyvatar.claim,app.bsky.actor.profile` | Tap README (comma separated) |
| `TAP_ADMIN_PASSWORD` | from Infisical; clients use Basic auth with user `admin` | Tap README and quick start |
| `TAP_DATABASE_URL` | the Railway Postgres connection string, or the default SQLite file on the `/data` volume | Tap README |
| `TAP_LOG_LEVEL` | `error` | quick start |

- **Pin the version.** The quick start uses `:latest`. Pin a tag or digest instead (the tag list was not checked, so look in the indigo package registry). Upgrade by changing the pin in staging, watching for a clean backfill, then promoting.
- **Postgres storage.** The README says `TAP_DATABASE_URL` accepts a PostgreSQL connection string but gives no Postgres example or setup. Test it in staging. The volume plus SQLite default is the documented fallback.
- **Private access.** Do not generate a public domain for Tap (the quick start does so only for testing). Reach it from `indexer` over Railway private networking, `TAP_URL=http://tap.railway.internal:2480`. Railway's private network hostname format was not verified against its docs, so confirm it in the dashboard.
- **Jetstream fallback.** Tap is in beta. If it fails, switch the indexer to Jetstream (<https://atproto.com/guides/streaming-data>). That needs an indexer change to filter the same collections and does not exist yet.

## Cloudflare

DNS and proxy for `blueyvatar.com` on the free plan (spec section 14.1). Nothing else from Cloudflare is used.

1. Add the zone. Point `blueyvatar.com` (web) and the delivery hostname at their Railway domains with CNAME records, proxied (orange cloud). Set SSL/TLS mode to Full (strict). Exact record names depend on how web and delivery are split across hostnames and are not decided.
2. Caching: `/img/*` responses end in `.png`, `.jpeg`, or `.webp` and send `Cache-Control: public, max-age=31536000, immutable`, so the default cache rules cache them. The `/avatar` and `/u` redirects send `private`, so they are not cached. Confirm after deploy with `curl -sI https://<host>/img/...` and check `CF-Cache-Status` goes from `MISS` to `HIT`, and that redirects show no `HIT`. Do not add a Cache Everything rule.
3. `delivery` sets `TRUST_CLOUDFLARE=true` so rate limits read `CF-Connecting-IP`.
4. Origin lockdown (acceptance item in issue 53): the origin must reject traffic that skips Cloudflare, since `TRUST_CLOUDFLARE=true` makes the client IP header spoofable. **Unconfirmed and not implemented.** Candidates are a secret header added at the edge and checked in delivery, or Cloudflare's authenticated origin pulls. Neither was checked against Railway or Cloudflare docs.
5. Purge token: create an API token with the Cache Purge permission scoped to the zone. Put it in Infisical as `CF_API_TOKEN` and the zone ID as `CF_ZONE_ID`. Purge limits on the Free plan (URL purge up to 100 per request and 800 URLs per second, prefix and hostname purge 5 requests per minute): <https://developers.cloudflare.com/cache/how-to/purge-cache/>. API reference: <https://developers.cloudflare.com/api/resources/cache/methods/purge/>.

## Infisical secrets

Set per environment and sync them to Railway service variables. Names match `.env.example`.

| Secret | Used by |
| --- | --- |
| `DATABASE_URL` | delivery, indexer, web (if it reads the database) |
| `TAP_ADMIN_PASSWORD` | tap, indexer |
| `TAP_URL` | indexer |
| `CF_ZONE_ID`, `CF_API_TOKEN` | indexer |
| `PUBLIC_DELIVERY_URL` | indexer (cache warming and purge URLs) |
| `CF_PURGE_MODE` (optional) | indexer |
| `PUBLIC_URL`, `DELIVERY_URL` | web |
| `DEFAULT_URL_ALLOWLIST`, `TRUST_CLOUDFLARE`, `PORT`, `PG_POOL_MAX` | delivery (and indexer for `PG_POOL_MAX`) |
| OAuth client signing key | web (name not defined in `.env.example` yet; add it there when the web agent defines it) |

Infisical's Railway integration steps were not verified here.

## Logging

Railway keeps service logs for a plan-dependent period. The spec requires a short, published retention period for request logs (section 9). Which period to publish, and whether Railway's retention is short enough, is open.

## Release checklist

1. Merge to the branch the environment tracks. Railway builds the Dockerfile for each service whose watch patterns changed.
2. `delivery` runs pending migrations, then starts. A failing migration aborts the deploy and leaves the previous version running.
3. Check `/healthz` on delivery, the web home page, and the indexer logs for a Tap connection.
