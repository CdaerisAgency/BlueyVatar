# BlueyVatar handoff for the local agent (v6)

Written November 4, 2026, from the cloud session that built phases 1 and 2. The step-by-step commands are in `docs/deploy.md`, and that runbook wins if anything here conflicts with it. This file explains where things stand, what you are expected to do, and the rules the owner has set.

## 1. What the project is

BlueyVatar (blueyvatar.com) is a Gravatar-style avatar and profile service built on atproto. Avatars and profile data live in each user's own atproto repository. The service adds email lookup, fast image delivery, and paid developer tiers. The full spec is `docs/spec/blueyvatar-product-spec-v12.md`.

- Repository: `CdaerisAgency/BlueyVatar` (the old lowercase URL redirects; set your remote to `https://github.com/CdaerisAgency/BlueyVatar.git`)
- Local path: `C:\Users\super\OneDrive\Documents\GitHub\BlueyVatar`
- Do not touch `CdaerisAgency/atlas`. It is a different project.

## 2. Owner's standing rules

1. **PRs:** open every PR as ready for review (not draft). Once both CI jobs, `check` and `docker`, pass, merge it with a merge commit. You don't need to ask first. The owner gave this as a permanent order.
2. **CI** runs on GitHub-hosted runners (`runs-on: ubuntu-latest`) because the repository is public and a self-hosted runner on a public repository lets anyone who opens a pull request run code on that machine (<https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions>). The repository variable `CI_RUNNER` is retired. Only `deploy.yml` uses a self-hosted runner, named by the repository variable `DEPLOY_RUNNER` with no fallback. The pnpm cache was removed on purpose; leave it out unless the owner asks.
3. **Writing:** use U.S. English. Never use em-dashes. Avoid "not X, but Y" phrasing.
4. **Versioning:** put a version number on every new document and on each revision (v1, v2, and so on).
5. **Sources:** take facts from vendor documentation. If nothing is published on a point, say so instead of guessing, and mark the item **unconfirmed** in the docs.
6. **Secrets** live in Infisical. Never commit a secret value.
7. **Low-resource mode (owner decision, November 7, 2026):** "because we have no user adoption right now, all services, fly, neon, etc, should be configured for the lowest resource use and uptime acceptable." Web and delivery scale to zero; indexer and Tap stay at one small always-on machine each; Tap's volume is 1 GB; Neon uses the minimum compute and the shortest scale-to-zero the plan allows. Details, sources, and how to scale up are in the "Low-resource mode" section of `docs/deploy.md`. Do not add keepalive pings or raise sizes without the owner's say.

## 3. Current state

Everything that could be built without live credentials is merged to `main`. That covers PRs 1, 73, 74, 75, and 76.

| Area | Status |
| --- | --- |
| Monorepo | pnpm 10.28.0, Node 22, TypeScript 5.9.3. Apps: `apps/web` (Next.js 16, OAuth login, account pages, public profiles), `apps/delivery` (Hono image and redirect API), `apps/indexer` (Tap consumer). Packages: `packages/core`, `tools/migrate`. Lexicons are under `lexicons/` |
| Database | Five migrations in `db/migrations` (0001 to 0005). They have not been applied to Neon yet. The first Fly deploy of delivery applies them through `release_command` |
| Hosting choice | Fly.io (region `iad`) plus Neon Postgres. Railway was dropped |
| Neon | Project `rough-heart-79040132` in `aws-us-east-1`, Postgres 16. Branch `production` has 0.25 to 1 CU autoscaling and suspends when idle. Branch `staging` has 0.25 to 1 CU and suspends after 5 minutes. Under low-resource mode, set both branches to the minimum compute and the shortest scale-to-zero the plan allows (`docs/deploy.md`). Database `blueyvatar`, role `blueyvatar_app` |
| Fly | Nothing created yet. Configs are `fly/web.toml`, `fly/delivery.toml`, `fly/indexer.toml`, `fly/tap.toml` |
| Cloudflare | Nothing configured yet. The plan is the Free plan: DNS, proxy, cache, one Transform Rule, and Cloudflare for SaaS for custom profile domains |
| CI deploy | `.github/workflows/deploy.yml` is opt-in. It stays off until the repository variable `FLY_DEPLOY_ENABLED` is `true` and the secret `FLY_API_TOKEN` exists |
| Pricing | Draft proposal: https://claude.ai/artifact/5YgAzJJ995PfgeEsvL8FxS (issue 67): the owner approved the pricing. Stripe is the payment processor; configure Stripe Tax and invoicing at deploy |

## 4. What you need from this machine

- The `fly` CLI, logged in to the owner's Fly organization.
- Infisical access (CLI or MCP connector), with one environment each for `staging` and `production`.
- A Cloudflare API token with DNS edit, Transform Rules edit, Cache Purge, and SSL and Certificates (for Cloudflare for SaaS) on the `blueyvatar.com` zone.
- Neon access (console or MCP), to read the connection strings.
- Node 22 and pnpm 10.28.0. On Windows, use `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` wherever the runbook says `openssl rand -hex 32`.

If any of these is missing, stop and tell the owner which one. Don't work around it.

## 5. Your task: deploy, staging first

Follow `docs/deploy.md`, and do staging before production.

1. **Hostnames are approved and the owner owns `blueyvatar.com` with DNS in Cloudflare.** Web is `blueyvatar.com`, delivery is `img.blueyvatar.com`, and the Cloudflare for SaaS fallback origin is `profiles.blueyvatar.com`. Create DNS records and Fly certificates for these. The OAuth client ID is `https://blueyvatar.com/oauth-client-metadata.json`, so web needs the apex domain.
2. **Pin the Tap image.** Done: `fly/tap.toml` pins `ghcr.io/bluesky-social/indigo/tap:0.1.10` with its digest (highest semver tag in the registry, image built 2026-03-11). Re-check the registry before an upgrade.
3. **Create the secrets in Infisical** for each environment, using the per-app table in `docs/deploy.md` under "Infisical secrets".
   - Get `DATABASE_URL` (pooled; the host contains `-pooler`) and `DATABASE_URL_DIRECT` from Neon.
   - Generate `ORIGIN_SECRET`, `SESSION_SECRET`, and `TAP_ADMIN_PASSWORD` as random hex strings. Tap and indexer use the same `TAP_ADMIN_PASSWORD`.
   - Generate `TOKEN_ENCRYPTION_KEY` with `openssl rand -base64 32`. Web refuses to start in production without it, and it must be set before the `0007_encrypt_oauth.sql` deploy reaches web. Rotating it signs every user out.
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
| 55 | Tangled adapter (`org.tangled.actor.profile` enabled, `sh.tangled.actor.profile` enabled as a fallback; see `docs/research/tangled-collection-v2.md`) |

These need the owner's decision and are not your work: issue 67 (pricing) and issues 60 and 66 (legal).

## 7. Decisions waiting on the owner

- **Neon production:** keep suspend-on-idle (the current setting, which is cheapest but slower on the first request) or never suspend (about $19.35 a month more).

## 8. Known follow-ups (not blocking deploy)

- Pin `superfly/flyctl-actions/setup-flyctl@master` and the flyctl version in `deploy.yml`.
- Encrypt OAuth tokens at rest.
- Gate cross-origin `/profile` requests on the hovercards entitlement.
- Schedule re-verification of `rel="me"` link claims.
- Plus is sold through Stripe at $9.99 per month (owner decision). Create the Plus product and price, set `STRIPE_PRICE_PLUS` on the web app (see `docs/deploy.md`, Stripe billing), and apply migrations 0016 and 0017. With the variable unset Plus is not offered. `PLUS_DIDS` still grants Plus manually for testing and gifts.
- Email domain on link rows (issue #128, owner approved). Migration 0016 adds `email_links.email_domain`, filled at link time with the domain only, never the address. Links made earlier stay empty until the owner verifies the email again. `/privacy` discloses it. Delegated serving itself is not built yet (memo `docs/research/dns-delegation-v2.md`).
- Log retention period and a log shipper (the spec requires a published retention period).
- Verify the Tap `TAP_DATABASE_URL` path form (`sqlite:///data/tap.db`) in staging.
