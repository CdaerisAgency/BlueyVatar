<img src="https://cdaeris.com/wp-content/uploads/2025/09/Circle-Text-for-Light-Background.png" alt="Cdaeris" width="200">

# BlueyVatar codebase audit v2

v2, 2026-11-15: adds the results of phases 1 and 2 (#335 to #347) and corrects the v1 line count. The v1 text follows below, unchanged except for the size figure.

## Results

### Correction

v1 said the codebase was about 40,300 lines. The count dropped part of the file list. The real figure at `8b04126` was **48,628 lines** (15,273 tests, 33,355 source).

### Line count after the work

| | Before (`8b04126`) | After (`a05efa0`) | Change |
|---|---|---|---|
| Total | 48,628 | 48,835 | +207 |
| Tests | 15,273 | 15,127 | -146 |
| Source | 33,355 | 33,708 | +353 |

The work did not reduce lines overall. v1 estimated each removed duplicate and missed the cost of the new files, imports and helper signatures a split adds. Splitting one 765-line file into ten route files, for example, repeats imports in each.

| Lane | PR | v1 estimate | Actual net (all files, from the PR) |
|---|---|---|---|
| A: changelog fragments | #336 | conflict fix | +126 |
| B: core subpath exports | #337 | conflict fix | +3 |
| C: deploy doc and env split | #338 | about -60 | +22 |
| D: migration number test | #335 | conflict fix | +10 |
| E: CI setup action | #339 | about -20 | -19 |
| F: delivery routes | #344 | about -150 | +223 |
| G: indexer jobs | #341 | about -150 | -5 |
| H: web admin | #342 | about -170 | -97 |
| I: web lib plumbing | #345 | about -190 | -114 |
| J: account data and copy | #346 | about -12 | +38 |
| K: account pages | #343 | about -280 | +19 |
| L: shared helpers | #347 | about -75 | +17 |

### Conflict points after the work

| File | Before | After | A new feature now |
|---|---|---|---|
| `CHANGELOG.md` | edited by every PR | not edited | adds a file in `changelog.d/` |
| `docs/deploy.md` | 881 lines | 32-line index | adds a file in `docs/deploy/` and one index line |
| `.env.example` | 190 lines | 92 (shared only) | edits its own app's `.env.example` |
| `packages/core/src/index.ts` | one line per module | frozen | imports `@blueyvatar/core/<name>` |
| `apps/delivery/src/app.ts` | 765 lines | 119 | adds a file in `src/routes/` and one mount line |
| `apps/delivery/src/app.test.ts` | 1,065 lines | deleted | adds a per-route test file |
| `apps/indexer/src/index.ts` | import and call per job | one list | adds a job file and one list line |
| `apps/web/lib/copy.ts` | 104 lines | 10 | edits its area file in `lib/copy/` |
| `apps/web/lib/account-data.ts` | query, delete and doc per table | data list | adds an entry in `account-data/sources.ts` |
| `apps/web/lib/store.ts` | 487 lines | 205 | edits the store file for its concern |
| `apps/web/lib/admin/review.ts` | 492 lines | split into 5 files | edits the file for its concern |
| `.github/workflows/ci.yml` | 231 lines | 167 | adds a library to `build:libs` |

A test now fails when two migrations share a number. `AGENTS.md` describes the new layout.

### Still open

- **In-memory stores in `apps/web/lib` (about 470 lines):** owner decision. Removing them means web development and tests always need a database.
- **`tools/loadtest` (about 600 lines):** owner decision.
- **Pattern variants left on purpose:** these accept different input from the shared core versions, so unifying them would change behavior. `records.ts` time zone check (stricter than core); DID checks in indexer `moderation-digest.ts` and `admin/config.ts` (any non-space body), `tick-route.ts` (any lowercase method, body up to 512), `labels.ts` in core and indexer (no length cap); email checks in `reports.ts` and `bug-report.ts` (looser).

---


2026-11-15, against `main` at `8b04126`. Read-only audit: no code was changed.

## Summary

- **Size:** 48,628 lines of code (corrected in v2; v1 said about 40,300). About 33,400 are source and 15,300 are tests.
- **Line reduction available:** about 1,300 lines (3%) without any owner decision. Up to about 2,400 (6%) if the owner also approves removing the in-memory stores and the load-test tool (section 4).
- **Over-caution:** very little. Almost every `try/catch` and re-check guards a real trust boundary or a documented fail-open path. The few real cases are in section 3.
- **The larger gain is parallel work.** Eight shared files account for most merge conflicts. Each has a fix that turns "edit the shared file" into "add a new file" (section 1). Under main's up-to-date rule, every conflict costs a branch update and a full CI run, so these come first.

Method: git history of the last 150 commits on main for conflict counts, plus a file-by-file read of each area. Line estimates are net and approximate. "High" confidence means the finding was confirmed by search across the repo.

## 1. Conflict points: files that many pull requests edit

Counts are commits touching the file out of the last 150 on main.

| File | Commits | Why it collides | Fix |
|---|---|---|---|
| `docs/deploy.md` (881 lines) | 67 | One runbook for every feature; each feature adds a section or env table | Split into `docs/deploy/` with one file per topic (apps, staging, tap, cloudflare, rate limits, bug reports, email, screening, stripe, effects). `deploy.md` becomes an index |
| `CHANGELOG.md` | 62 | Every PR adds a line at the same place | One fragment file per PR in `changelog.d/<pr>.md`, assembled into `CHANGELOG.md` by a script at deploy time. The CI `changelog` job checks for a fragment |
| `.env.example` (190 lines) | 31 | Every feature appends a commented block near the end | One `.env.example` per app, with the long explanations moved to the matching deploy doc. Cuts about 60 lines |
| `.github/workflows/ci.yml` | 28 | Setup steps are copied in the `check` and `e2e` jobs, so action bumps and "build package X" edits land in several places | One composite action `.github/actions/setup` and a root `build:libs` script. About 50 lines out of `ci.yml`, 30 into the action |
| `apps/delivery/src/app.ts` (765) and `app.test.ts` (1,065) | 23 and 22 | Every route lives in one 610-line function; every route test in one file | Section 2.1 |
| `apps/web/lib/copy.ts` | 22 | One `COPY` object for all pages | Split by page area (`copy/account.ts`, `copy/admin.ts`, `copy/public.ts`); `copy.ts` re-exports |
| `apps/web/lib/account-data.ts` and its test | 18 and 14 | Every new table adds a query to the export, a `DELETE` to the purge, and a doc line | A registry: each feature exports `{ key, exportSql, deleteSql }` from its own folder; `account-data.ts` loops over them. Also removes 17 hand-written `DELETE` statements (about 12 lines) |
| `packages/core/src/index.ts` and `package.json` exports | 17 | Every new module appends an `export *` line at the end | Wildcard subpath export (`"./*"`) in `packages/core/package.json`. New modules are imported as `@blueyvatar/core/<name>`; the barrel is frozen |
| `apps/indexer/src/index.ts` | 17 | Every job adds an import and a call | Section 2.2 |
| `apps/web/app/account/page.tsx` | 20 | Data loading and six sections in one file | Move each section to its own component file next to `GallerySection` and `ShareSection` |

Not fixable by structure: `pnpm-lock.yaml` (43) and `apps/web/package.json` (22). A pnpm `catalog:` for shared versions such as vitest would cut the second one.

**Migrations.** `tools/migrate` reads `db/migrations/*.sql` in sorted order with no journal file, so adding a migration never conflicts in git. Nothing stops two PRs from both taking `0046`, though, and number `0034` is already missing. Add a test (about 10 lines) that fails on a duplicate number prefix.

## 2. Structural splits

### 2.1 Delivery API

`createApp` in `apps/delivery/src/app.ts` holds 13 routes. Proposed layout:

- `app.ts` (about 90 lines): build context, apply middleware, mount routes.
- `context.ts`: `entitle`, `clientIp`, `visibilityAllows`, `signedPath`, and a new `gateProfile`.
- `http.ts`: `fail`, `overloaded`, `rateHeaders`, `originHost`.
- `routes/service.ts` (healthz, readyz, metrics, openapi), `routes/usage.ts`, `routes/avatar.ts`, `routes/profile.ts`, `routes/qr.ts`, `routes/go.ts`, `routes/img.ts`, `routes/default.ts`.
- `test/harness.ts` plus one test file per route, split at the existing `describe` blocks.
- `openapi/paths/<route>.ts`, merged by `openapi.ts`.

Adds about 80 lines of wiring. A new route then touches only its own three files.

### 2.2 Indexer jobs

Seven job files each carry their own copy of "run once, set an interval, log, report errors". Proposed: each job is a file in `jobs/` exporting `{ name, everyMs, run }`, and one `startJobs` runner. Adding a job is one new file plus one line in a list.

### 2.3 Web library files to split

- **`admin/review.ts` (492):** `review-queue.ts`, `review-locks.ts`, `case-detail.ts`, `wellness.ts`, `case-actions.ts`.
- **`store.ts` (487):** `pool.ts`, `web-sessions.ts`, `email-links-pg.ts`, `oauth-stores.ts`; `store.ts` keeps the interface and the two compositors.
- **`records.ts` (400):** `image-validate.ts`, `profile-validate.ts`; `records.ts` keeps collections and text helpers.
- Next: `rate-limit.ts`, `billing/stripe.ts` (checkout and plan change), `account/profile/ProfileForm.tsx` (three row-list fieldsets), `account/billing/page.tsx` (`OrgBilling` is a second page in the same file).

## 3. Line reductions that need no owner decision

| # | Area | Finding | Net lines | Confidence |
|---|---|---|---|---|
| 1 | web lib | Dead admin functions in `admin/moderation.ts` (`unsuspend`, `unblockImage`, `dismissReport`, `listReports`, `getReport`, and the old `takedown` and `suspend`) and `listAppeals` in `admin/appeals.ts`. Only `admin.test.ts` calls them; the live path is `performCaseAction` in `review.ts` | 155 | High |
| 2 | web app | `ProfileForm.tsx` re-implements `FormNotices` and the focus effect, and has three copies of a keyed row list | 110 | Medium |
| 3 | delivery tests | Table-driven cases and a license fixture helper in `app.test.ts`; three other test files reuse the harness | 130 | Medium |
| 4 | web tests | 12 database test files each create and drop a schema by hand; one `useSchema` helper | 80 | High |
| 5 | web tests | Shared fixtures (`img`, `pngBytes`, billing constants) copied across test files | 60 | High |
| 6 | web lib | Nine hand-written `BEGIN/COMMIT/ROLLBACK` blocks; one `inTx(pool, fn, { lock })` | 60 | High |
| 7 | indexer | Seven copies of the schedule wrapper; one helper | 60 | High |
| 8 | indexer | `effects-switch.ts` and `schedule-switch.ts` differ only in SQL, path and timeout; one `tickJob` helper. Their tests merge into one table | 90 | High |
| 9 | core and web | `apps/web/lib/effects/time.ts` re-implements `localDate`, `addDays` and start-of-day, which `packages/core/src/schedule.ts` already has. `isValidTimezone` in `records.ts` duplicates the core one | 55 | High |
| 10 | tools | `tools/make-favicons.py` is referenced nowhere; its outputs are committed | 48 | High |
| 11 | web lib | Test-only or unreferenced exports (`getOffer`, `scanCounts`, `keyKindOf`, `readSession`, `isApexDomain`, `validateProfile`, and others) | 45 | High for zero-reference ones |
| 12 | web app | `export const dynamic = 'force-dynamic'` on 19 account pages. Each already reads cookies through `requireDid`, and `next.config.ts` already sends `no-store` for `/account` | 38 | High |
| 13 | web app | Three copies of the server-action `run`/`back` wrapper (effects, schedule, holidays); one `redirectAction` helper | 30 | High |
| 14 | web app | Error, done and load-error banners pasted in about 18 pages; one `<Notices>` component. "Signed in as" paragraph repeated 11 times | 40 | High |
| 15 | web app | The two tick route handlers are the same file apart from imports; one `makeTickRoute`. Both hand-roll a timing-safe compare that delivery already has | 25 | High |
| 16 | web lib | Ten copies of the global store singleton pattern | 25 | High |
| 17 | delivery | The profile gate (resolve, repo active, hidden, visibility) is written three times in `/profile`, `/qr` and `/go` | 20 | High |
| 18 | all | Small duplicates: `DID_RE` (8 definitions in 5 variants), `originHost` vs `requestHost`, `PUBLIC_URL` default (7 places), trailing-slash trim (8 places), `longDate` (3), `Check/ok/fail` types (6), email regex (3) | 75 | High |
| 19 | web app | Admin page header wrapper, repo-load `try/catch` helper, `requireDidAction` | 40 | Medium |
| 20 | config | `.env.example` comments and CI setup duplication (from section 1) | 80 | High |

Total: about 1,270 lines.

### Over-caution found

- `apps/delivery/src/app.ts:287-294`: on the hash path, `serveAvatar` repeats the repo-active and visibility checks the gate just ran. Two extra database queries per request.
- `apps/web/lib/billing/webhook.ts:97,106`: fetches the same subscription twice.
- `apps/web/lib/report-form.ts:10-36`: parses the report once per field, then again.
- `apps/delivery/src/app.ts:523`: sets `nosniff` again after the global middleware set it.
- Row mappers: 26 `?? null` on values the Postgres driver already returns as null.
- The 19 `force-dynamic` lines in row 12.

Checked and left alone on purpose: Stripe webhook payload checks, the rate-guard fail-open blocks, URL parsing in `profile-export.ts`, the resolver's fail-closed `hidden: true`, and the session check in every server action. These are trust boundaries or documented behavior.

## 4. Reductions that need an owner decision

| Item | Lines | Question |
|---|---|---|
| In-memory store fallbacks in `apps/web/lib` (`store.ts`, `billing/store.ts`, `push-store.ts`, `claim-store.ts`, `dashboard-store.ts`, others) | about 470 | The README promises in-memory mode only for the delivery API. If web development always has a database, these can go and the tests run on Postgres |
| `tools/loadtest` | about 600 | Referenced only by `docs/research/load-test-v1.md` and `docs/licensing-v2.md`. No script or CI job runs it |
| `localdeploy.bat` (370 lines) | not estimated | It is the production deploy path today, so no change is proposed. Listed because it duplicates `deploy.yml` |

## 5. Suggested lanes

Each lane owns the listed paths and nothing else. Phase 1 lanes do not overlap and can run at the same time. Phase 2 lanes move code, so no feature work should be open in the same paths while they run.

**Phase 1: conflict points (small PRs, run in parallel)**

| Lane | Owns | Work |
|---|---|---|
| A | `CHANGELOG.md`, `changelog.d/`, changelog job in `ci.yml`, `AGENTS.md` rule | Changelog fragments |
| B | `packages/core/package.json`, `AGENTS.md` rule | Wildcard subpath exports; freeze the barrel |
| C | `docs/deploy.md`, `docs/deploy/`, `.env.example` files | Split the runbook and env examples |
| D | `tools/migrate` test | Duplicate-number test |
| E | `.github/actions/setup`, non-deploy parts of `ci.yml`, root `package.json` script | Composite setup action. Must merge after lane A, since both edit `ci.yml` |

**Phase 2: splits (one lane per area)**

| Lane | Owns | Work |
|---|---|---|
| F | `apps/delivery/src` | Route files, test harness, per-route tests, profile gate, table-driven tests |
| G | `apps/indexer/src` | Job files, schedule helper, tick-job helper |
| H | `apps/web/lib/admin` | Delete dead moderation functions, split `review.ts` |
| I | `apps/web/lib/store.ts`, `tx.ts`, `pool.ts`, `testing/` | `inTx`, singleton helper, store split, shared test helpers |
| J | `apps/web/lib/account-data.ts`, `copy.ts` | Registry and copy split |
| K | `apps/web/app/account`, `apps/web/components` | Notices, action wrapper, tick route, `force-dynamic`, ProfileForm, page splits |
| L | `packages/core`, `apps/web/lib/effects/time.ts`, `records.ts` | Shared time, DID and regex helpers. Runs after I and K, since it edits import lines across web |

Lanes F, G, H and K are independent of each other. I and J both touch `apps/web/lib` top-level files and should run one after the other.
