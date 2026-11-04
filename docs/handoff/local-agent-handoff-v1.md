# blueyvatar handoff for the local agent (v1)

Written November 4, 2026, from the cloud session that built phases 1 and 2. The step-by-step commands are in `docs/deploy.md`, and that runbook wins if anything here conflicts with it. This file explains where things stand, what you are expected to do, and the rules the owner has set.

## 1. What the project is

blueyvatar (blueyvatar.com) is a Gravatar-style avatar and profile service built on atproto. Avatars and profile data live in each user's own atproto repository. The service adds email lookup, fast image delivery, and paid developer tiers. The full spec is `docs/spec/blueyvatar-product-spec-v6.md`.

- Repository: `CdaerisAgency/BlueyVatar` (the old lowercase URL redirects; set your remote to `https://github.com/CdaerisAgency/BlueyVatar.git`)
- Local path: `C:\Users\super\OneDrive\Documents\GitHub\BlueyVatar`
- Do not touch `CdaerisAgency/atlas`. It is a different project.

## 2. Owner's standing rules

1. **PRs:** open every PR as ready for review (not draft). Once both CI jobs, `check` and `docker`, pass, merge it with a merge commit. You don't need to ask first. The owner gave this as a permanent order.
2. **CI** runs on the owner's on-prem runners through the repository variable `CI_RUNNER`. Keep `runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}`. The pnpm cache was removed on purpose, so don't add it back.
3. **Writing:** use U.S. English. Never use em-dashes. Avoid "not X, but Y" phrasing.
4. **Versioning:** put a version number on every new document and on each revision (v1, v2, and so on).
5. **Sources:** take facts from vendor documentation. If nothing is published on a point, say so instead of guessing, and mark the item **unconfirmed** in the docs.
6. **Secrets** live in Infisical. Never commit a secret value.

## 3. Current state

Everything that could be built without live credentials is merged to `main`. That covers PRs 1, 73, 74, 75, and 76.

| Area | Status |
| --- | --- |
| Monorepo | pnpm 10.28.0, Node 22, TypeScript 5.9.3. Apps: `apps/web` (Next.js 16, OAuth login, account pages, public profiles), `apps/delivery` (Hono image and redirect API), `apps/indexer` (Tap consumer). Packages: `packages/core`, `tools/migrate`. Lexicons are under `lexicons/` |
| Database | Five migrations in `db/migrations` (0001 to 0005). They have not been applied to Neon yet. The first Fly deploy of delivery applies them through `release_command` |
| Hosting choice | Fly.io (region `iad`) plus Neon Postgres. Railway was dropped |
| Neon | Project `rough-heart-79040132` in `aws-us-east-1`, Postgres 16. Branch `production` has 0.25 to 1 CU autoscaling and suspends when idle. Branch `staging` has 0.25 to 1 CU and suspends after 5 minutes. Database `blueyvatar`, role `blueyvatar_app` |
| Fly | Nothing created yet. Configs are `fly/web.toml`, `fly/delivery.toml`, `fly/indexer.toml`, `fly/tap.toml` |
| Cloudflare | Nothing configured yet. The plan is the Free plan: DNS, proxy, cache, one Transform Rule, and Cloudflare for SaaS for custom profile domains |
| CI deploy | `.github/workflows/deploy.yml` is opt-in. It stays off until the repository variable `FLY_DEPLOY_ENABLED` is `true` and the secret `FLY_API_TOKEN` exists |
| Pricing | Draft proposal: https://claude.ai/artifact/5YgAzJJ995PfgeEsvL8FxS (issue 67, waiting on the owner's sign-off) |

## 4. What you need from this machine

- The `fly` CLI, logged in to the owner's Fly organization.
- Infisical access (CLI or MCP connector), with one environment each for `staging` and `production`.
- A Cloudflare API token with DNS edit, Transform Rules edit, Cache Purge, and SSL and Certificates (for Cloudflare for SaaS) on the `blueyvatar.com` zone.
- Neon access (console or MCP), to read the connection strings.
- Node 22 and pnpm 10.28.0. On Windows, use `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` wherever the runbook says `openssl rand -hex 32`.

If any of these is missing, stop and tell the owner which one. Don't work around it.

## 5. Your task: deploy, staging first

Follow `docs/deploy.md`, and do staging before production.

1. **Decide the hostnames with the owner.** The runbook leaves open how web and delivery split across hostnames. A typical split is `blueyvatar.com` for web, a separate host for delivery (for example `img.blueyvatar.com`), and `profiles.blueyvatar.com` as the SaaS fallback origin. Get confirmation before you create DNS records. The OAuth client ID is proposed as `https://blueyvatar.com/oauth-client-metadata.json`, so web needs the apex domain.
2. **Pin the Tap image.** `fly/tap.toml` uses the placeholder tag `PIN_REAL_TAG`. Find a real tag or digest for `ghcr.io/bluesky-social/indigo/tap` in the indigo package registry, open a PR with the pin, and merge it once CI passes.
3. **Create the secrets in Infisical** for each environment, using the per-app table in `docs/deploy.md` under "Infisical secrets".
   - Get `DATABASE_URL` (pooled; the host contains `-pooler`) and `DATABASE_URL_DIRECT` from Neon.
   - Generate `ORIGIN_SECRET`, `SESSION_SECRET`, and `TAP_ADMIN_PASSWORD` as random hex strings. Tap and indexer use the same `TAP_ADMIN_PASSWORD`.
   - Generate `OAUTH_PRIVATE_JWK` with `pnpm --filter @blueyvatar/web gen-jwk`.
   - Ask the owner for `RESEND_API_KEY` and `EMAIL_FROM`, plus the optional GitHub OAuth app and service account values, if they aren't already in Infisical.
4. **Create the Fly apps and the Tap volume**, push the secrets with `fly secrets set`, then deploy in this order: tap, delivery (this runs the migrations), web, indexer.
5. **Set up Cloudflare** using "Cloudflare" steps 1 to 7 in `docs/deploy.md`. That covers proxied CNAMEs, SSL Full (strict), Fly certificates, the `Origin auth` Transform Rule that adds `x-origin-auth`, the Cloudflare for SaaS fallback origin, and the purge token.
6. **Turn on CI deploys.** Create an org-scoped Fly token (`fly tokens create org`) and store it as the GitHub secret `FLY_API_TOKEN`. Then set the repository variable `FLY_DEPLOY_ENABLED=true`.
7. **Smoke test** (issues 52 and 53):
   - `/healthz` on delivery returns 200.
   - A direct hit on `https://blueyvatar-delivery.fly.dev/u/x` returns 403 (`origin_forbidden`).
   - The same path through Cloudflare works.
   - `/img/...` shows `CF-Cache-Status` moving from `MISS` to `HIT`.
   - Log in with a Bluesky account, upload an avatar, and confirm the indexer logs show it arriving through Tap.
8. **Promote to production** with the same steps, using the production Infisical environment and the production Neon branch.

After each step, update the "Provisioned resources" section of `docs/deploy.md` with what you created: names and IDs only, never secret values. Ship that update as a PR under the standing merge rule.

## 6. Open issues you can close or advance after deploy

| Issue | What it needs |
| --- | --- |
| 42 | Live Tap test against the real firehose |
| 52, 53 | Staging and production deploy, origin lockdown verified |
| 54 | Publish the lexicons (needs the domain live and name clearance confirmed; the owner says clearance is done) |
| 55 | Tangled adapter (disabled in `packages/core/src/adapters.ts` until Tangled publishes the needed data) |

These need the owner's decision and are not your work: issue 67 (pricing) and issues 60 and 66 (legal).

## 7. Decisions waiting on the owner

- **Neon production:** keep suspend-on-idle (the current setting, which is cheapest but slower on the first request) or never suspend (about $19.35 a month more).

## 8. Known follow-ups (not blocking deploy)

- Pin `superfly/flyctl-actions/setup-flyctl@master` and the flyctl version in `deploy.yml`.
- Encrypt OAuth tokens at rest.
- Gate cross-origin `/profile` requests on the hovercards entitlement.
- Schedule re-verification of `rel="me"` link claims.
- Billing storage. Everyone is on Free for now, and `PLUS_DIDS` grants Plus for testing.
- Log retention period and a log shipper (the spec requires a published retention period).
- Verify the Tap `TAP_DATABASE_URL` path form (`sqlite:///data/tap.db`) in staging.
