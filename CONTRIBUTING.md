# Contributing

## Setup

Requirements: Node 22 and pnpm 10.28.0 (`corepack enable` picks up the version from `package.json`).

```sh
pnpm install
cp .env.example .env            # optional for local runs
pnpm lex:build                  # generate lexicon types
pnpm --filter @blueyvatar/core build
```

See the README for the repository layout and how to run each service.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm -r typecheck` | Typecheck every package |
| `pnpm -r test` | Run every test suite |
| `pnpm -r build` | Build every package |
| `pnpm db:migrate` | Apply `db/migrations` to the database in `DATABASE_URL` |
| `pnpm e2e` | Run the browser tests in `apps/web/e2e` (see "Browser tests") |
| `pnpm smoke -- --env staging\|production` | Smoke test deployed apps (see "Smoke test") |
| `pnpm lex:build` | Regenerate lexicon types |
| `pnpm lex:install <nsid>` | Install a third-party lexicon into `lexicons/vendor` |

## Tests with a local Postgres

The Postgres integration tests run when `TEST_DATABASE_URL` is set and skip otherwise. Each run creates and drops its own schema, so a shared scratch database is fine. CI uses `postgres:16`:

```sh
docker run -d --name blueyvatar-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=blueyvatar_test -p 5432:5432 postgres:16
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/blueyvatar_test
DATABASE_URL=$TEST_DATABASE_URL pnpm db:migrate
pnpm -r test
```

## Browser tests

`apps/web/e2e` holds a Playwright suite that drives the production build of the web app with `next start`. It covers the landing, pricing, login, 404, and seeded profile pages, the report form and its limit of 5 per hour, and the signed-out redirect of every `/account/*` page. A small stub server stands in for the delivery API. No Resend key and no PDS are configured, so nothing leaves your machine. The report form needs Postgres, so run the migrations first:

```sh
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/blueyvatar_test   # see "Tests with a local Postgres"
DATABASE_URL=$TEST_DATABASE_URL pnpm db:migrate
pnpm --filter @blueyvatar/web build
pnpm --filter @blueyvatar/web exec playwright install chromium   # once
pnpm e2e
```

Set `PW_CHROMIUM_PATH` to use a Chromium you already have instead of installing one. `E2E_DATABASE_URL` overrides `TEST_DATABASE_URL`, and `E2E_WEB_PORT` and `E2E_STUB_PORT` (default 3100 and 3101) move the servers when those ports are busy. The suite reuses a server that is already running on the web port outside CI. CI runs it as the `e2e` job.

## Smoke test

`tools/smoke/smoke.ts` checks a live deployment over HTTPS: delivery `/healthz`, the 403 `origin_forbidden` on the direct Fly hostname, the same response for an unlinked and an opted-out hash, `/img` cache status moving from `MISS` to `HIT`, `/p/{handle}`, the OAuth metadata and JWKS, and the Stripe webhook refusing an unsigned body. It exits 1 on any failure.

```sh
pnpm smoke -- --env production
SMOKE_ORIGIN_SECRET=... SMOKE_HANDLE=alice.bsky.social pnpm smoke -- --env staging
```

| Variable | Purpose |
| --- | --- |
| `SMOKE_WEB_URL`, `SMOKE_DELIVERY_URL`, `SMOKE_ORIGIN_URL` | Override the URLs for the chosen environment (defaults are in the script) |
| `SMOKE_ORIGIN_SECRET` | Sent as `x-origin-auth` on delivery checks. Staging has no Cloudflare, so it needs the staging `ORIGIN_SECRET`. Never sent on the direct-hostname check |
| `SMOKE_HANDLE` | An account with an avatar. Without it the cache and profile checks are skipped |
| `SMOKE_OPTED_OUT_HASH` | SHA256 of an email whose owner opted out. Without it the script compares two random unlinked hashes |

`.github/workflows/deploy.yml` runs it against production after each deploy and fails the workflow on error. Set the repository variables `SMOKE_HANDLE` and `SMOKE_OPTED_OUT_HASH` to enable the optional checks. Its unit tests run with `pnpm -r test`.

## Migrations

Add a new numbered file to `db/migrations`. The runner applies files in filename order and does not rerun applied files, so never edit a migration that has shipped.

## Pull requests

- Branch from `main` and open the PR against `main`.
- CI must pass (typecheck, tests, web build, browser tests, Docker build).
- Use merge commits. Do not rebase. If `main` moves, merge `origin/main` into your branch.
- Put `Closes #N` in the PR description for the issue it finishes, or `Refs #N` when it only contributes.
- Write U.S. English and do not use em-dashes.
- Never commit secrets or a filled-in `.env`.

## Security

Report vulnerabilities as described in [SECURITY.md](SECURITY.md), not in public issues.
