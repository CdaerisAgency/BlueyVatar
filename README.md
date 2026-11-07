# blueyvatar

blueyvatar is a Gravatar-style avatar service built on atproto. Users keep their avatar images and profile records in their own repository on their own PDS. The service indexes those records, links verified email hashes to atproto identities, and serves resized avatars through Cloudflare's free CDN at Gravatar-compatible URLs (`/avatar/{sha256}`, or `/avatar/{md5}` for older Gravatar clients), with atproto identities as a second route (`/u/{handle-or-did}`).

This code follows the product spec at [docs/spec/blueyvatar-product-spec-v6.md](docs/spec/blueyvatar-product-spec-v6.md). Section numbers in code comments refer to spec v6.

## Layout

| Path | What it holds |
| --- | --- |
| `packages/core` | Shared logic: query parameters, ratings, tier entitlements, profile source adapters, identity resolution order, email hashing. Lexicon types are generated into `packages/core/src/lexicons` (gitignored). |
| `apps/delivery` | Delivery API (Hono on Node). Entitlement checks, rate limits, usage metering, visibility rules, and image resizing in a sandboxed child process using sharp. |
| `apps/indexer` | Follows Tap and writes image, profile, claim, and repo status changes to Postgres. |
| `apps/web` | Next.js app: sign-in with atproto OAuth (confidential client), profile pages, and the OAuth client metadata document. |
| `lexicons/com/blueyvatar` | The service's own lexicons: `image`, `profile`, `claim`, `attestation`. |
| `lexicons/vendor` | Lexicons installed with `lex install` and pinned by CID in `lexicons.json`. |
| `db/migrations` | Postgres schema, applied in file order by `tools/migrate`. |
| `tools/migrate` | Migration runner (`pnpm db:migrate`). |
| `Dockerfile`, `fly/` | One image and per-app Fly.io config. See [docs/deploy.md](docs/deploy.md). |

## More documentation

- [docs/self-hosting-v1.md](docs/self-hosting-v1.md): components, environment variables, migrations, and a Docker Compose example for running your own instance.
- [CONTRIBUTING.md](CONTRIBUTING.md): setup, commands, tests, and pull request conventions.
- [SECURITY.md](SECURITY.md): how to report a vulnerability.

## Local development

Requirements: Node 22 and pnpm 10.28.0 (`corepack enable` picks up the version from `package.json`).

```sh
pnpm install
cp .env.example .env            # optional for local runs
pnpm lex:build                  # generate lexicon types into packages/core/src/lexicons
pnpm --filter @blueyvatar/core build   # other packages import core from its dist output
pnpm -r typecheck
pnpm -r test
```

Run the services:

```sh
pnpm --filter @blueyvatar/delivery build && pnpm --filter @blueyvatar/delivery start   # port 3001
pnpm --filter @blueyvatar/indexer build && pnpm --filter @blueyvatar/indexer start     # needs a running Tap
pnpm --filter @blueyvatar/web dev                                                      # port 3000
```

Without `DATABASE_URL`, the delivery API uses in-memory stores and the indexer logs its writes to the console. To use Postgres, create a database, apply the migrations, and set `DATABASE_URL`:

```sh
DATABASE_URL=postgres://... pnpm db:migrate
```

Production runs on Fly.io with Neon Postgres. Apps connect through Neon's pooled endpoint (`DATABASE_URL`). Migrations prefer `MIGRATE_DATABASE_URL`, then `DATABASE_URL_DIRECT` (the direct endpoint), then `DATABASE_URL`, because the pooled endpoint does not hold session-level advisory locks reliably.

Migrations use a small in-repo runner (`tools/migrate`, built on `pg`). It applies `db/migrations/*.sql` in filename order, one transaction per file, records them in `schema_migrations`, and skips files already applied. Deploys run from `.github/workflows/deploy.yml` and are covered in [docs/deploy.md](docs/deploy.md).

The Postgres integration tests run when `TEST_DATABASE_URL` is set. Each run creates and drops its own schema, so a shared scratch database is fine. The delivery test script builds `dist` first, because the sandboxed resizer test runs the compiled worker.

### Lexicons

`lex install` manages its target directory and deletes any lexicon JSON file missing from `lexicons.json`. For that reason, third-party lexicons go in `lexicons/vendor` and the service's own lexicons stay outside it. Always install through the script:

```sh
pnpm lex:install com.atproto.some.nsid   # writes lexicons/vendor and updates lexicons.json
pnpm lex:build                           # reads all of lexicons/, including vendor
```

`lex install` resolves lexicon authorities with DNS TXT lookups (`_lexicon.<authority>`), so it needs normal DNS access.

### Secrets

Secrets (database credentials, the Tap admin password, the OAuth client signing key) live in Infisical. `.env.example` lists every variable the apps read. Never commit a filled-in `.env`.

## Phase 1 TODO

- [ ] Web: complete the OAuth sign-in and callback routes with `@atproto/oauth-client-node`, loading the signing key from Infisical.
- [ ] Web: record editor for `com.blueyvatar.image`, `com.blueyvatar.profile`, and `com.blueyvatar.claim`, including blob upload.
- [ ] Web: email linking (spec section 6): read `email` and `emailConfirmed` from `getSession`, the trusted PDS host list, the one-time code fallback, and unlinking.
- [ ] Web: account and license dashboard: issue, label, rotate, and revoke `sk_` and `pk_` keys (store only the SHA256 and a display prefix), plus domain lists for publishable keys.
- [ ] Web: visibility rule settings, with the plain-language notice that repo data stays public (spec section 10.2).
- [x] Claims: GitHub and Mastodon OAuth, rel="me" for websites, Instagram and X, attestations (Postgres, plus the service repo when `SERVICE_REPO_DID` and `SERVICE_APP_PASSWORD` are set). Follow-up: scheduled re-verification, TikTok and Threads.
- [ ] Indexer: deploy Tap on Fly.io with the service profile as the signal collection and the five collections as filters; implement the `onPurge` hook for cache warming (done: see docs/deploy.md, CDN cache warming).
- [ ] Delivery: count the `transform` meter when a new variant is generated, and add usage alerts at 80 and 100 percent of included volume.
- [x] Database: migration runner (`tools/migrate`) and hourly cleanup of expired `rate_windows` rows.
- [ ] Adapters: confirm the Tangled profile avatar field before enabling that adapter.
- [ ] Lexicons: clear the `com.blueyvatar` namespace and publish the schemas under `_lexicon.blueyvatar.com`.
- [x] Billing: Stripe Checkout, Customer Portal, and a signed webhook (spec section 12.1). Follow-up: a Plus price, the overage rate, and the Stripe dashboard setup in docs/deploy.md.
