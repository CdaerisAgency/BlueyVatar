# CI deploys

`.github/workflows/deploy.yml` deploys only when someone starts it by hand (workflow dispatch): staging first, a smoke test against staging, then production, then a smoke test against production. Production starts only if the staging deploy and the staging smoke test both succeeded (`deploy-production` has `needs: deploy-staging`).

**How to start it.** Merging to `main` does not deploy. Open Actions > Deploy > Run workflow and pick the `main` branch, or ask the lead agent in chat to dispatch it through the GitHub Actions API. A dispatch from any other ref is skipped.

**What allows it to run.** All three must be in place, or the run does nothing:

- The repository variable `FLY_DEPLOY_ENABLED` is `true`. Set it after the first manual deploy has created the apps.
- The secret `FLY_API_TOKEN` exists in Settings > Secrets and variables > Actions > Secrets. It must be able to deploy all six apps (staging and production). **Unconfirmed:** whether one org-scoped token covers both.
- The repository variable `DEPLOY_RUNNER` names the owner's runner. There is no GitHub-hosted fallback because the jobs hold `FLY_API_TOKEN`, so a missing value fails the job instead of running elsewhere.

Optional: `SMOKE_HANDLE` and `SMOKE_OPTED_OUT_HASH` (variables) enable the extra smoke checks (the same as production). `tools/smoke/smoke.ts` also reads `SMOKE_ORIGIN_SECRET` for staging, which has no Cloudflare in front, but the workflow does not pass it. Whether staging needs it: Unknown.

**Jobs.** `deploy-staging` (environment `staging`) deploys delivery, web, then indexer to the `blueyvatar-*-staging` apps with the same commands as `localdeploy.bat`, including `--env TAP_URL=http://blueyvatar-tap-staging.internal:2480` for the indexer, then runs `tools/smoke/smoke.ts --env staging`. `deploy-production` (environment `production`) deploys the production apps in the same order and runs `--env production`. Delivery goes first because its release command runs the migrations, so a migration reaches staging before production. Staging smoke targets are `https://blueyvatar-web-staging.fly.dev` and `https://blueyvatar-delivery-staging.fly.dev` (the smoke script defaults). Each smoke test retries up to three times, 30 seconds apart.

**Choosing the target.** When you start the run, pick `target`: `both` (the default) or `staging`. `staging` stops after the staging smoke test. Both choices need `FLY_DEPLOY_ENABLED` and the `main` branch.

**Other rules.** The jobs install flyctl with `superfly/flyctl-actions/setup-flyctl` (<https://github.com/superfly/flyctl-actions>), run only for `refs/heads/main`, and GitHub creates the `staging` and `production` environments on first use with no reviewers. CI (`ci.yml`), the npm publish and Live Tap workflows run on GitHub-hosted `ubuntu-latest`; the old `CI_RUNNER` variable is retired. Runs queue under `concurrency: deploy-<ref>` and never cancel each other. The flyctl version is `latest`; pin an exact release when you pick one.

`localdeploy.bat` remains for emergencies, such as when Actions or the runner is down.

### Roll back production

The workflow does not roll back. If a production deploy or its smoke test fails, the workflow fails and the apps stay as they are. To go back, list releases with their images and deploy an earlier image for each affected app (no rebuild), as described in Fly's guide <https://docs.fly.io/blueprints/rollback-guide> and the `fly releases --image` reference <https://docs.fly.io/flyctl/cmd/fly_releases>:

```sh
fly releases --app blueyvatar-web --image
fly deploy --app blueyvatar-web --image registry.fly.io/blueyvatar-web:deployment-XXXXXXXX
```

Repeat for `blueyvatar-delivery` and `blueyvatar-indexer` as needed. Rollbacks do not undo database migrations that delivery already applied, so check that the older image works with the current schema first. The image must still exist in the Fly registry. Also turn off `FLY_DEPLOY_ENABLED` (or fix `main`) so nobody redeploys the bad change by mistake.

**Tap is deployed by hand.** Restarting Tap interrupts the firehose connection, and an image upgrade can force a re-backfill, so someone should watch each Tap deploy. It also changes rarely.

### Public repository checklist (owner)

The workflows are written for a public repository, but these GitHub settings cannot be changed from a workflow. The owner must do them; the pull request that added this list changed none of them. Menu paths are as documented by GitHub at <https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions>, <https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment>, <https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/managing-access-to-self-hosted-runners-using-groups>, <https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/configuring-private-vulnerability-reporting-for-a-repository>, and <https://docs.github.com/en/code-security/secret-scanning/enabling-secret-scanning-features/enabling-push-protection-for-your-repository>.

In this order, so deploys never break:

1. Set the variable `DEPLOY_RUNNER` to the on-prem runner's label: Settings > Secrets and variables > Actions > Variables > New repository variable. Do this before merging the workflow change, since `deploy.yml` has no fallback.
2. Restrict the runner: Settings > Actions > Runners (organization: Organization settings > Actions > Runner groups). Put the runner in a runner group that only this repository may use, and give the runner a label that only deploys target.
3. Merge the workflow pull request. CI runs on the runners named by the variable `CI_RUNNER` (owner decision, November 8, 2026), and on GitHub-hosted runners when the variable is unset. Step 6 below is then the only gate between an outside pull request and those machines, so approve a fork pull request only after reading its workflow, script, and test changes.
4. Keep the variable `CI_RUNNER` set to the CI runner label. Only the deploy job uses `DEPLOY_RUNNER`.
5. Add required reviewers to the `production` environment: Settings > Environments > production > Required reviewers (the environment is created on the first deploy run after the merge, or create it earlier under Settings > Environments > New environment). Optionally limit deployment branches to `main`.
6. Settings > Actions > General > Fork pull request workflows from outside collaborators: choose "Require approval for all outside collaborators".
7. Settings > Actions > General > Workflow permissions: choose "Read repository contents and packages permissions".
8. Settings > Advanced Security (or Code security and analysis): enable Private vulnerability reporting, Secret scanning, and Push protection.

Required reviewers on an environment do not make a self-hosted runner safe for untrusted code, which is why only the main-only deploy job holds secrets on one. CI also uses the owner’s runners, so keep fork approval on for all outside collaborators.
