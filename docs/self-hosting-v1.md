# Self-hosting guide (v1)

This guide covers running blueyvatar on your own infrastructure (issue #39, spec section 3 row 30). It collects what the repository already documents in [deploy.md](deploy.md), `.env.example`, and the `fly/` configs. The project has no license yet, so check the repository for a `LICENSE` file before you rely on the code for your own deployment. Anything the repo does not document is marked "not yet documented".

Nothing here has been run as a self-hosted install by the maintainers. The Fly.io and Neon setup in [deploy.md](deploy.md) is the reference deployment.

## Components

| Component | What it does | Command | Port | Public |
| --- | --- | --- | --- | --- |
| web | Next.js app: atproto OAuth sign-in, profile pages, account dashboard | `cd apps/web && node_modules/.bin/next start -H 0.0.0.0 -p 3000` | 3000 | yes |
| delivery | Hono API that serves `/avatar`, `/u`, and signed `/img` paths | `node apps/delivery/dist/server.js` | 3001 (`PORT`) | yes, health check at `/healthz` |
| indexer | Follows Tap and writes record changes to Postgres | `node apps/indexer/dist/index.js` | none (no HTTP server) | no |
| Tap | Sync service that the indexer connects to | image `ghcr.io/bluesky-social/indigo/tap` | 2480 | no |
| Postgres | Shared database | any Postgres; CI uses `postgres:16` | 5432 | no |

Delivery and the indexer run with in-memory stores or console logging when `DATABASE_URL` is unset, which suits local trials only (README, Local development). A CDN in front of delivery is how production caches `/img/*`; see "CDN" below.

## Build

Requirements: Node 22 and pnpm 10.28.0.

```sh
pnpm install
pnpm lex:build
pnpm -r build
```

The root `Dockerfile` does the same and produces one image that holds web, delivery, indexer, and the migration runner. It ends with `CMD ["node", "apps/delivery/dist/server.js"]`, so set the command per service.

## Environment variables

Names and meanings come from `.env.example`. Copy it to `.env` as a starting point. Never commit a filled-in file.

| Variable | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | delivery, indexer, web | Postgres connection string. Run migrations before first use. |
| `DATABASE_URL_DIRECT` | migrations | Direct (non-pooled) connection. Only needed when `DATABASE_URL` points at a pooler. |
| `MIGRATE_DATABASE_URL` | migrations | Overrides the two above for migrations. |
| `TAP_URL` | indexer | Default `http://localhost:2480`. |
| `TAP_ADMIN_PASSWORD` | Tap, indexer | Same value on both. Clients use Basic auth with user `admin`. |
| `PUBLIC_URL` | web | Public base URL of web. Also the origin of the OAuth client ID (`PUBLIC_URL/oauth-client-metadata.json`). |
| `DELIVERY_URL` | web | Base URL of delivery. |
| `IMG_SIGNING_SECRET` | delivery, indexer | Same value on both. See "Secrets". |
| `ORIGIN_SECRET` | delivery | Optional origin lockdown. See "Secrets". |
| `TRUST_CLOUDFLARE` | delivery | `true` only when Cloudflare is in front, so the client IP comes from `CF-Connecting-IP`. |
| `PORT` | delivery | Listen port, default 3001. |
| `SESSION_SECRET` | web | Required in production (web throws when it is unset). |
| `TOKEN_ENCRYPTION_KEY` | web, indexer | Required in production. See "Secrets". |
| `OAUTH_PRIVATE_JWK` | web | OAuth client signing key. See "Secrets". |
| `TRUSTED_PDS_HOSTS` | web | Comma-separated hosts trusted for direct email linking. |
| `RESEND_API_KEY`, `EMAIL_FROM` | web, indexer | One-time codes and notices. With no key, email falls back to the console. |
| `PUBLIC_DELIVERY_URL` | indexer | Public origin of delivery. Warming is skipped and purges are only logged when unset. |
| `CF_ZONE_ID`, `CF_API_TOKEN` | indexer | Cloudflare cache purge. Purges are only logged when either is unset. |
| `CF_PURGE_MODE` | indexer | Optional, `prefix` or the default `files`. |
| `DEFAULT_URL_ALLOWLIST` | delivery | Optional hosts allowed as a custom `d=` default image URL. |
| `PG_POOL_MAX` | delivery, indexer | Optional pool size (delivery 10, indexer 5). |
| `LOG_RETENTION_DAYS` | delivery | Optional log age limit, default and maximum 90. Purges database-held logs (report IP hashes, processed Stripe event ids). |
| `LOG_RETENTION_MAX_GB` | delivery | Optional size cap in GB per log store, default 5. Set your log destination to the same limits. |
| `MIGRATIONS_DIR` | migrations | Optional override of `db/migrations`. |

Optional features, each described in `.env.example`: custom profile domains (`CF_SAAS_ZONE_ID`, `CF_SAAS_API_TOKEN`, `CF_SAAS_FALLBACK_ORIGIN`), GitHub verification (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`), and attestation records in a service repo (`SERVICE_REPO_DID`, `SERVICE_APP_PASSWORD`, `SERVICE_PDS_URL`). The indexer needs the three `SERVICE_*` values to delete revoked attestations from the service repo. The full per-app secret list is in [deploy.md](deploy.md), section "Infisical secrets". That page also says which web variables are required in production was not audited beyond `.env.example`, so treat the web list as a starting point.

Log retention: the hosted service keeps logs 90 days or until a 5 GB size cap, whichever comes first, and says so on `/privacy`. If you run your own instance, publish your own period on your privacy page, and set the same limits at your log destination (Fly keeps logs only briefly). Sizing and per-destination settings are in [deploy.md](deploy.md), section "Log retention".

## Secrets to generate

- `IMG_SIGNING_SECRET`: `openssl rand -hex 32`. Delivery signs `/img` paths with it and refuses unsigned or altered paths with 403 `invalid_signature`. The indexer needs the same value to warm and purge `/img` URLs. If it is unset, delivery uses a random per-process value and logs a warning, so signed URLs break on every restart and across replicas.
- `TOKEN_ENCRYPTION_KEY`: `openssl rand -base64 32` (32 bytes, base64 or hex). It encrypts OAuth tokens and the stored primary email in Postgres (AES-256-GCM). Web and indexer must share the same value, because the indexer decrypts the primary email to send revocation notices. Web refuses to start in production without it. Rotating it makes stored addresses unreadable, and notices are skipped until users verify again.
- Origin auth secret (`ORIGIN_SECRET`): `openssl rand -hex 32`. When set, every delivery request except `GET /healthz` must carry the header `x-origin-auth` with this value, or delivery answers 403 `origin_forbidden`. Your proxy or CDN has to add the header. [deploy.md](deploy.md) shows the Cloudflare Request Header Transform Rule for it. Leave it unset to accept all requests.
- `SESSION_SECRET`: random hex string (the handoff doc generates it that way, `docs/handoff/local-agent-handoff-v4.md`).
- `TAP_ADMIN_PASSWORD`: random hex string, the same on Tap and the indexer.
- `OAUTH_PRIVATE_JWK`: `pnpm --filter @blueyvatar/web gen-jwk` (script `apps/web/scripts/gen-jwk.ts`). The output format and how to pass it are not yet documented beyond that comment in `.env.example`.

## Migrations

The runner in `tools/migrate` applies `db/migrations/*.sql` in filename order, one transaction per file, records each in `schema_migrations`, and skips files already applied. It holds a session-level advisory lock, so use a direct connection and not a transaction-mode pooler.

From a checkout:

```sh
DATABASE_URL_DIRECT=postgres://... pnpm db:migrate
```

`pnpm db:migrate` runs `pnpm --filter @blueyvatar/migrate migrate`, which builds and then runs `node dist/cli.js`. It reads `MIGRATE_DATABASE_URL`, then `DATABASE_URL_DIRECT`, then `DATABASE_URL`, and exits with an error if none is set. From the built image, the equivalent is `node tools/migrate/dist/cli.js` (the Fly release command). Run migrations before starting a new version.

## Pointing Tap and the indexer at your relay

What the repo documents:

- The indexer reads `TAP_URL` and `TAP_ADMIN_PASSWORD` and talks only to Tap.
- `fly/tap.toml` configures Tap with `TAP_BIND`, `TAP_SIGNAL_COLLECTION` (`com.blueyvatar.profile`), `TAP_COLLECTION_FILTERS` (`com.blueyvatar.image,com.blueyvatar.profile,com.blueyvatar.claim,app.bsky.actor.profile,app.bsky.actor.link,org.tangled.actor.profile,sh.tangled.actor.profile`), `TAP_LOG_LEVEL`, and `TAP_DATABASE_URL` (`sqlite:///data/tap.db` on a mounted volume).
- Tap's own environment names are listed in its README: <https://github.com/bluesky-social/indigo/blob/main/cmd/tap/README.md>.

Which Tap variable selects the upstream relay or firehose, and its default, is not yet documented in this repo. Check the Tap README above for that setting, set it on the Tap container, then point the indexer at your Tap with `TAP_URL`. Keep Tap off the public internet. Tap is in beta, and the Jetstream fallback does not exist yet (deploy.md, section "Tap").

## CDN

Delivery's `/img/*` responses send `Cache-Control: public, max-age=31536000, immutable` and the `/avatar` and `/u` redirects send `private` (deploy.md, section "Cloudflare"). Any CDN that honors those headers can sit in front. The repo only documents Cloudflare: cache purge from the indexer (`CF_ZONE_ID`, `CF_API_TOKEN`, `PUBLIC_DELIVERY_URL`) and the `x-origin-auth` header rule. Other CDNs are not yet documented, and without Cloudflare credentials purges are logged only.

## Docker Compose example

The repo has a root `Dockerfile` and no compose file. This sketch is an example, not a tested configuration. It reuses the commands from deploy.md and the Tap settings from `fly/tap.toml`. Save it as `docker-compose.yml` in the repository root and fill in the values.

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: change-me
      POSTGRES_DB: blueyvatar
    volumes:
      - pgdata:/var/lib/postgresql/data

  tap:
    image: ghcr.io/bluesky-social/indigo/tap:0.1.10@sha256:5e20bfe416d29fcd215ed8bf99f10b2ab825a6de4e5599846dd33967ade2abeb
    environment:
      TAP_BIND: ":2480"
      TAP_SIGNAL_COLLECTION: com.blueyvatar.profile
      TAP_COLLECTION_FILTERS: com.blueyvatar.image,com.blueyvatar.profile,com.blueyvatar.claim,app.bsky.actor.profile,app.bsky.actor.link,org.tangled.actor.profile,sh.tangled.actor.profile
      TAP_DATABASE_URL: sqlite:///data/tap.db
      TAP_ADMIN_PASSWORD: ${TAP_ADMIN_PASSWORD}
    volumes:
      - tapdata:/data

  delivery:
    build: .
    command: ["node", "apps/delivery/dist/server.js"]
    environment:
      DATABASE_URL: postgres://postgres:change-me@postgres:5432/blueyvatar
      IMG_SIGNING_SECRET: ${IMG_SIGNING_SECRET}
      ORIGIN_SECRET: ${ORIGIN_SECRET}
    ports:
      - "3001:3001"
    depends_on: [postgres]

  indexer:
    build: .
    command: ["node", "apps/indexer/dist/index.js"]
    environment:
      DATABASE_URL: postgres://postgres:change-me@postgres:5432/blueyvatar
      TAP_URL: http://tap:2480
      TAP_ADMIN_PASSWORD: ${TAP_ADMIN_PASSWORD}
      IMG_SIGNING_SECRET: ${IMG_SIGNING_SECRET}
      TOKEN_ENCRYPTION_KEY: ${TOKEN_ENCRYPTION_KEY}
    depends_on: [postgres, tap]

  web:
    build: .
    command: ["sh", "-c", "cd apps/web && node_modules/.bin/next start -H 0.0.0.0 -p 3000"]
    environment:
      DATABASE_URL: postgres://postgres:change-me@postgres:5432/blueyvatar
      PUBLIC_URL: https://avatars.example.com
      DELIVERY_URL: http://delivery:3001
      SESSION_SECRET: ${SESSION_SECRET}
      TOKEN_ENCRYPTION_KEY: ${TOKEN_ENCRYPTION_KEY}
      OAUTH_PRIVATE_JWK: ${OAUTH_PRIVATE_JWK}
      TRUSTED_PDS_HOSTS: ${TRUSTED_PDS_HOSTS}
    ports:
      - "3000:3000"
    depends_on: [postgres]

volumes:
  pgdata:
  tapdata:
```

Run migrations once before the apps start:

```sh
docker compose up -d postgres
docker compose run --rm delivery node tools/migrate/dist/cli.js
docker compose up -d
```

The image runs as user `node`, and the Tap volume permissions are not yet documented. The relay setting for Tap is covered above.

## Not yet documented

- The Tap variable that selects a relay.
- The format of `OAUTH_PRIVATE_JWK` output and how to supply it.
- Non-Cloudflare CDN setup and purge.
- The license, and which parts of the repo a self-hoster may reuse.
- Separating the delivery layer from billing and license code (acceptance item in issue #39).
