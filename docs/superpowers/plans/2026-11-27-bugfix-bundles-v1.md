# Bug and fix bundles (before enhancements) Implementation Plan v1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear every known bug and fix on the BlueyVatar backlog in three bundled PRs, one per codebase area, before any enhancement work (integrations come after).

**Architecture:** Three independent bundles touch disjoint files, so each gets its own worktree and branch off `origin/main` and can run in parallel. Each bundle ends in one PR, merged with a merge commit as soon as CI (check, docker, e2e, wordpress-plugin, changelog) is green. Worktree and branch are deleted after merge.

**Tech Stack:** pnpm 10 (`corepack pnpm`), Node 22, TypeScript, Next.js 16 (apps/web), Vitest, Playwright e2e, `@atproto/oauth-client-node`, Postgres via `pg`.

**Spec:** GitHub issues #332, #225, #355, #358 (draft PR), #362, #356 in CdaerisAgency/BlueyVatar; `docs/spec/blueyvatar-product-spec-v14.md` for copy and behavior.

## Global Constraints

- U.S. English, no em-dashes, avoid "not X, but Y" phrasing. Site copy lives in `apps/web/lib/copy.ts` (and `apps/web/lib/copy/*`).
- Every new document gets a version suffix (`-v1`).
- Each PR adds a fragment under `changelog.d/` (the changelog CI check requires it).
- Workflows keep `runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}` and no pnpm cache.
- Never log OAuth tokens, cookies, or secret values. Log the error class and message only.
- Build `packages/core`, `packages/hovercards`, `packages/avatar` before `corepack pnpm -r typecheck` / `-r test`.
- Tap targets on phones are at least 44 px (from #351).

## Review Focus

1. **OAuth restore fails for a reason other than a missing session** (network error to the PDS, revoked refresh token). The person should see the same honest "sign in again" message with a sign-in link, and the log should carry the cause. Covered by Task A1 test `logs the restore cause and keeps tokens out`.
2. **Two Fly machines refresh the same DID's token at once.** Only one refresh should hit the PDS; the other should reuse the result. Covered by Task A3 test `serializes concurrent calls for the same key`.
3. **Local dev with no `DATABASE_URL`.** The request lock must fall back to an in-process lock and not crash. Covered by Task A3 test `falls back to in-process lock without a pool`.
4. **Back/forward cache restores a page after sign-out.** The header must refresh to signed out. Covered by Task A2 e2e.
5. **Windows paths with a drive letter** (`C:\...`) in tooling tests. Covered by the #358 changes in Task C1, run on Windows locally.

---

## Step 0: Housekeeping (no worktree)

- [ ] Merge #360, #361, #363 once Dependabot finishes the rebase and CI is green (rebase already requested on 2026-11-27).
- [ ] Close #356 with the comment "Superseded by #357 (same next 16.4.5 bump, merged)." Its lockfile was never updated.
- [ ] Leave #326 open: blocked upstream until `@atproto/dev-env` supports zod 4. No code.

---

## Bundle A: web session and auth (`fix/web-session`) — #332, #225

Worktree: `.claude/worktrees/web-session` off `origin/main`.

### Task A1: Honest restore failure with logged cause (#332 parts 1 and 2)

**Files:**
- Modify: `apps/web/lib/repo.ts:46-53` (`repoSession`)
- Modify: `apps/web/app/account/profile/page.tsx:26,37` (show sign-in link with the message)
- Modify: `apps/web/lib/copy.ts` (or the matching file under `apps/web/lib/copy/`): add `COPY.session.expired` and `COPY.session.signInAgain`
- Test: `apps/web/lib/repo.test.ts` (create)

**Interfaces:**
- Produces: `export class SessionExpiredError extends RepoError {}` in `repo.ts`. `repoSession(did)` throws it on any `restore` failure. Callers that already catch `RepoError` keep working.
- Produces: `COPY.session.expired: string`, `COPY.session.signInAgain: string`.

- [ ] **Step 1: Write the failing tests** in `apps/web/lib/repo.test.ts`, mocking `./auth` so `oauthClient().restore` rejects:
  - `throws SessionExpiredError when restore rejects`: `await expect(repoSession('did:plc:x')).rejects.toBeInstanceOf(SessionExpiredError)`.
  - `logs the restore cause and keeps tokens out`: spy on `log.warn` from `./obs`; restore rejects with `new Error('refresh failed token=abc')`. Assert `log.warn` called once with `'oauth restore failed'` and an object whose `did === 'did:plc:x'` and `errorName === 'Error'`. Assert the serialized call args do not contain `'token=abc'`.
- [ ] **Step 2: Run** `corepack pnpm --filter @blueyvatar/web exec vitest run lib/repo.test.ts`. Expected: FAIL (`SessionExpiredError` not exported).
- [ ] **Step 3: Implement.** In the `catch (err)` of `repoSession`, call `log.warn('oauth restore failed', { did, errorName: err instanceof Error ? err.name : typeof err })` and throw `new SessionExpiredError(COPY.session.expired)`. Do not log `err.message` (it can carry token fragments).
- [ ] **Step 4: Profile page.** When `err instanceof SessionExpiredError`, render the alert plus `<Link href={loginPath('/account/profile')}>{COPY.session.signInAgain}</Link>` (min 44 px tap target).
- [ ] **Step 5: Run** the test file again. Expected: PASS. Then `corepack pnpm --filter @blueyvatar/web typecheck`.
- [ ] **Step 6: Commit** `fix(web): honest message and logged cause when the Bluesky session cannot be restored (#332)`.

### Task A2: Refresh the header after Back/forward cache (#332 part 3, #225 leftovers)

**Files:**
- Modify: `apps/web/components/useViewer.ts`
- Test: `apps/web/e2e/session-bfcache.spec.ts` (create)
- Test: `apps/web/lib/viewer-route.test.ts` (add one case)

**Interfaces:**
- Produces: `useViewer()` keeps its signature `(): ClientViewer`; it now also reloads on `pageshow` when `event.persisted` is true.

- [ ] **Step 1: Write the failing e2e** `header refreshes after sign-out and Back`: sign in with the e2e test account, open `/account`, sign out, `page.goBack()`, expect the header to show the sign-in link within 2 s.
- [ ] **Step 2: Add unit case** in `viewer-route.test.ts`: `/api/viewer response is private and not stored`: assert the `cache-control` header contains `private` and `no-store` (closes the unchecked #225 cache item; if it already exists, skip this step and note it in the PR).
- [ ] **Step 3: Run** the e2e. Expected: FAIL (header still shows the account name).
- [ ] **Step 4: Implement** in the `useEffect`: add a `pageshow` listener that, when `e.persisted`, sets `inflight = null` and calls `load()` then `setV`. Remove the listener in the cleanup.
- [ ] **Step 5: Run** both tests. Expected: PASS.
- [ ] **Step 6: Commit** `fix(web): refresh the signed-in header when a page comes back from the Back/forward cache (#332, #225)`.

### Task A3: Request lock for OAuth token refresh (#332 part 4) — needs owner OK

**Files:**
- Create: `apps/web/lib/oauth-lock.ts`
- Modify: `apps/web/lib/auth.ts:19-26` (`buildClient` passes `requestLock`)
- Test: `apps/web/lib/oauth-lock.test.ts` (create)

**Interfaces:**
- Consumes: `inTx(pool, fn, { lock })` from `apps/web/lib/tx.ts`; `getPool(): pg.Pool | null` from `apps/web/lib/pool.ts`.
- Produces: `export async function oauthRequestLock<T>(name: string, fn: () => T | PromiseLike<T>): Promise<T>`, matching the `RuntimeLock` type from `@atproto/oauth-client-node`.

- [ ] **Step 1: Write the failing tests:**
  - `serializes concurrent calls for the same key`: with the in-process path, start two calls with the same name, each awaiting a 50 ms timer and pushing start/end markers; assert markers are `['s1','e1','s2','e2']`.
  - `runs different keys in parallel`: two names; assert both start before either ends.
  - `falls back to in-process lock without a pool`: mock `getPool` to return `null`; call resolves with `fn`'s value.
  - `uses a Postgres advisory lock when a pool exists`: mock `inTx`; assert it is called with `{ lock: 'oauth-refresh:<name>' }`.
- [ ] **Step 2: Run.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** With a pool: `inTx(pool, async () => fn(), { lock: \`oauth-refresh:${name}\` })`. Without: a module-level `Map<string, Promise<unknown>>` chain per name. Pass `requestLock: oauthRequestLock` in `buildClient`.
- [ ] **Step 4: Run** tests and `typecheck`. Expected: PASS.
- [ ] **Step 5: Docs.** Add a short "TOKEN_ENCRYPTION_KEY and sign-outs" note to the deploy docs file that covers web secrets under `docs/deploy/` (rotating the key signs everyone out; restore then fails with the new honest message).
- [ ] **Step 6: Commit** `fix(web): serialize OAuth token refresh across machines with an advisory lock (#332)`.

### Task A4: PR

- [ ] Add `changelog.d/` fragment. Push, open PR "Fix session restore message, Back-cache header, and token refresh races (#332, #225)", ready for review.
- [ ] Merge when green. Comment on #332 with evidence and close. Comment on #225: code done; owner steps left (www redirect in DNS, confirm `PUBLIC_URL`).

---

## Bundle B: web phone tap targets (`fix/web-mobile-targets`) — #355

Worktree: `.claude/worktrees/web-mobile` off `origin/main`.

### Task B1: Lift remaining targets to 44 px

**Files:**
- Modify: `apps/web/app/account/ShareSection.tsx:42-51` (download links)
- Modify: `apps/web/components/BugReport.tsx:~322` (`<summary>` toggles)
- Modify: home page link list (`apps/web/app/page.tsx`) and `/docs` index (`apps/web/app/docs/page.tsx`)
- Test: `apps/web/e2e/mobile-targets.spec.ts`

- [ ] **Step 1: Extend the spec** with the four selectors (share download links, bug report summaries, home link list, docs index links), asserting each bounding box height and width are at least 44 at 375 px width.
- [ ] **Step 2: Run** `corepack pnpm --filter @blueyvatar/web exec playwright test e2e/mobile-targets.spec.ts`. Expected: FAIL on the four new cases.
- [ ] **Step 3: Implement** with the same Tailwind utility pattern #351 used (reuse its class, do not invent a new one).
- [ ] **Step 4: Run** the spec plus the full phone-width suite from #354. Expected: PASS.
- [ ] **Step 5: Commit, changelog fragment, PR** "Lift remaining phone tap targets to 44 px (#355)". Merge when green. Comment on #355: code done; owner post-deploy Lighthouse rerun still listed.

---

## Bundle C: tooling and dependencies (`chore/tooling`) — #358, #362

Worktree: `.claude/worktrees/tooling` off `origin/main`.

### Task C1: Windows path fixes (absorb draft #358)

- [ ] **Step 1:** `git fetch origin pull/358/head:pr-358` and cherry-pick its commits.
- [ ] **Step 2: Run** `corepack pnpm -r test` on Windows (this machine). Expected: tools/lexicon, tools/migrate and the WordPress suite pass or skip cleanly without PHP.
- [ ] **Step 3: Commit** (cherry-picks keep their messages).

### Task C2: TypeScript 7 (#362)

- [ ] **Step 1:** Bump `typescript` to `7.0.2` in the root `package.json`, run `corepack pnpm install`.
- [ ] **Step 2: Run** `corepack pnpm -r typecheck`. Expected: FAIL with `TS2591: Cannot find name 'process'`.
- [ ] **Step 3: Implement:** add `"types": ["node"]` to `tsconfig.base.json` `compilerOptions`. Re-run.
- [ ] **Step 4:** If typecheck passes, run `-r test` and `-r build`. If errors remain that are not Node-types errors, **stop**: revert C2, add a Dependabot ignore for `typescript` major 7 in `.github/dependabot.yml`, and note the errors in the PR for a separate task.
- [ ] **Step 5: Commit** `chore: TypeScript 7 with explicit Node types (#362)`.

### Task C3: PR

- [ ] Changelog fragment, push, PR "Tooling: Windows paths and TypeScript 7 (#358, #362)". Merge when green. Close #358 and #362 as superseded with a link.

---

## Owner-only items (no code; listed so nothing is lost)

| Issue | What you do |
| --- | --- |
| #225 | Redirect `www.blueyvatar.com` to the apex in Cloudflare DNS; confirm `PUBLIC_URL` |
| #228 | Create the 100% Stripe test coupon, set `STRIPE_ALLOW_PROMO_CODES=true` on staging, check favicon on phone |
| #236 | Test one active key from an allowed domain, then revoke it |
| #237 | Stripe products, tax, portal, webhook, `STRIPE_*` secrets |
| #179 | Enable the 3 BlueyVatar rows in the CdaerisAgency/uptime repo after production deploy |
| #299 | Register a second self-hosted runner |
| #326 | Wait for `@atproto/dev-env` zod 4 support |

## After this plan

Enhancements start with integrations: #288 (profile card embed and oEmbed), npm publish of `@blueyvatar/avatar` and `@blueyvatar/hovercards`, #202 (wordpress.org listing), #295 (DNS SRV client helper). Each gets a brainstorm first.
