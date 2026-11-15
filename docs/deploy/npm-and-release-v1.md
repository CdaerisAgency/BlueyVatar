# Publish the npm packages

Two public packages ship from `packages/`: `@blueyvatar/avatar` (URL builder, hashing, Gravatar migration helper, React component) and `@blueyvatar/hovercards`. Neither is published yet. The workflow `.github/workflows/publish-npm.yml` runs only when a version tag such as `v0.1.0` is pushed, and it publishes with npm provenance. It fails before publishing if the `NPM_TOKEN` secret is missing.

### One-time setup (owner)

1. Create the `blueyvatar` organization on npmjs.com (owner decision on issue #153). Packages under the `@blueyvatar` scope are public, so the free plan is enough.
2. Create a granular access token on npmjs.com with read and write access to the `@blueyvatar` packages, and an expiry you will track. Store it in Infisical as `NPM_TOKEN`.
3. Add the same value as the GitHub repository secret `NPM_TOKEN` (Settings, Secrets and variables, Actions). Infisical stays the source of truth. Whether an Infisical to GitHub sync is set up here was not verified.
4. Provenance needs a public source repository when npm verifies the build. The repository is private today (see docs/licensing-v2.md), and npm rejects `--provenance` from a private repository. Make the repository public first, or remove `--provenance` from the workflow and from `publishConfig` in `packages/avatar/package.json` for a private-repo publish. This was not tested here.

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
