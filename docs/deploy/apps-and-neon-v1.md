# Apps

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
