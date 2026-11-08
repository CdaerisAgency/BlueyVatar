# Agent and contributor rules

Rules for AI agents and people working in this repository. `CLAUDE.md` points here, so this file is the single source. Read `CONTRIBUTING.md` and `SECURITY.md` as well.

## Layout and commands
- pnpm workspace: `apps/web` (Next.js site), `apps/delivery` (image and profile API), `apps/indexer`, `packages/*`, `db/migrations`, `lexicons`, `docs`.
- Install once with `pnpm install`. From the repo root: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e`, `pnpm db:migrate`.
- Run the fast checks on what you changed before you push (typecheck and the tests for the files you touched).

## Secrets and safety
- Never print, log, commit, or paste a secret, token, API key, or password. Credentials live in Infisical. If one appears in chat or a log, do not repeat it and tell the owner to rotate it.
- Do not touch deployment, DNS, Cloudflare, Stripe, Fly, or Infisical unless the task says to and the owner approved it.
- Do not put real promotion codes, keys, or personal data in the repo, docs, tests, or fixtures.
- Production database access is read-only, and only when the owner asks.
- Never skip, disable, or quarantine a test to get CI green.

## Working on a change
1. **One worktree per pull request.** Create it from the latest main: `git fetch origin main && git worktree add ../work/<name> -b <branch> origin/main`. Do not share a working tree between tasks.
2. **Check what is open first.** List open pull requests and issues before starting. If another open PR edits the same files, say so in the issue and agree who goes first instead of working in parallel.
3. **Stay in your area.** Split work by code area so pull requests do not overlap. Keep each PR to what its issue needs.
4. **Open pull requests as drafts and push once** when the work is finished. Mark ready only after you merged the latest main into the branch and the fast checks pass. CI should run once on finished work.
5. **Merge when green.** When every check passes, squash merge, mark ready first if it is a draft. Resolve conflicts by merging main into the branch; never rewrite history on a shared branch.
6. **Link the issue.** Use "Closes #N" only when the PR finishes the issue. Otherwise write "Part of #N".

## Deploying
- The full runbook is `docs/deploy.md`. Read it before any deploy-related work.
- Agents may deploy, run `fly` commands, change Fly secrets, and run migrations against staging or production, but only when the owner asks for that specific action in the current conversation. Never deploy on your own initiative, never deploy automatically (for example after a merge), and treat one approval as covering only the action named. Say what will be deployed and where, then wait for the go-ahead.
- CI deploys are opt-in. `.github/workflows/deploy.yml` runs on push to `main` only when the repository variable `FLY_DEPLOY_ENABLED` is `true`. Merging a PR can trigger a deploy, and any migration in it, when that variable is on, so say so in the PR when it adds a migration.
- Staging comes first. Test risky changes on staging with the owner before production.

## Files that many pull requests touch
These cause most merge conflicts. Handle them carefully.
- **`CHANGELOG.md`:** add one entry for user-visible changes, under the current date, in Added, Changed, or Fixed. On a conflict, keep both sides' entries.
- **Migrations (`db/migrations`):** take the next unused number at the time you open the PR. Check open PRs for the same number. If it is taken when you merge, renumber yours.
- **Spec (`docs/spec`):** one PR at a time edits the spec. A file rename gets its own PR.
- **Shared copy (`apps/web/lib/copy.ts`) and shared layout components:** keep edits small and merge main before you finish.

## Documents and versions
- When you revise a document, add or increment its version suffix (`-v1`, `-v2`). Update links that point to the old name in the same PR.
- Documents that carry the Cdaeris logo use the published logo at 200 px wide, with the height calculated from the image's native aspect ratio. Never hard-code image dimensions.

## Writing style
- U.S. English spelling.
- No em-dashes.
- Avoid "not X, but Y" and "It is not X. It is Y." constructions.
- Take facts from reference material (specifications, vendor docs, the code). If no published answer exists, write "Unknown" and say so. Do not guess.
- Plain wording for user-facing text. Name the real server when referring to a person's atproto home server, and do not assume the account is on Bluesky (see issue #246).

## Sub-agents
- Use the lowest-cost model that can do the work correctly: small models for mechanical work (conflict resolution, log reading, drafting), a mid-size model for code changes, and a larger one only when a cheaper one failed.
- Give each sub-agent a narrow scope, the files to read, and the rules above. Review its result before accepting it.
