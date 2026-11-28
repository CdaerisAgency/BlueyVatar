# Integration guides, /docs hub, and d=404 over-limit fix Implementation Plan v1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish four new platform guides, refresh the Discourse guide, add a "Show avatars on your site" hub to `/docs`, file later-work issues, and stop over-limit `d=404` requests from receiving the over-limit picture.

**Architecture:** Guides are Markdown in `docs/integrations/`, rendered by `apps/web/scripts/build-docs.mjs` into `/docs/integrations-<name>`. The hub is a section in `components/DocsView.tsx` (or the /docs index page) driven by a typed guide list. The delivery fix is one branch in `serveAvatar`.

**Tech Stack:** Markdown, Next.js 16 (apps/web), Hono (apps/delivery), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-27-integration-guides-design-v1.md`

## Global Constraints

- U.S. English, no em-dashes, avoid "not X, but Y"; file names end `-v1.md`; one `changelog.d/` fragment per PR.
- Hub copy lives in `apps/web/lib/copy*`. Do not claim "open source".
- Avatar host is `https://img.blueyvatar.com` (final).
- Only platform facts listed in the spec go in guides; nothing unverified.
- Two PRs: PR 1 = Tasks 1-2 (branch `docs/integration-guides`); PR 2 = Task 4 (branch `fix/over-limit-d404`). Task 3 is GitHub issues only.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A guide's example URL that BlueyVatar would reject** (bad `d`, size over 2048). Test: Task 1 `every guide URL example parses` runs each `img.blueyvatar.com/avatar/...` URL found in the four new guides through `parseAvatarParams` without a `ParamError`.
2. **A guide added on disk but missing from the hub.** Test: Task 2 `hub lists every guide` compares the hub list with `INTEGRATIONS` in build-docs.mjs.
3. **Over-limit with `d=404` on `/u/:id`, not only `/avatar/:hash`.** Test: Task 4 covers both routes.

---

### Task 1: Four new guides and the Discourse refresh

**Files:**
- Create: `docs/integrations/gitlab-v1.md`, `gitea-v1.md`, `forgejo-v1.md`, `redmine-v1.md`
- Modify: `docs/integrations/discourse-v1.md`, `apps/web/scripts/build-docs.mjs:12` (`INTEGRATIONS` gains `'gitlab', 'gitea', 'forgejo', 'redmine'`)
- Test: `apps/web/lib/integration-guides.test.ts`

**Interfaces:**
- Produces: `/docs/integrations-gitlab`, `-gitea`, `-forgejo`, `-redmine` pages.

- [ ] **Step 1: Write the failing test** `every guide URL example parses`: read each new guide, extract every `https://img.blueyvatar.com/avatar/...` URL (replace template placeholders like `%{hash}` with a 64-char hex hash and `%{size}` with `80`), run the query through `parseAvatarParams(q, { tier: 'free', defaultUrlAllowlist: [] })`, expect no throw. Also `each guide has the five sections` (headings: "What you change", "Steps", "Check it worked", "Without a BlueyVatar avatar", "Limits").
- [ ] **Step 2: Run** `corepack pnpm --filter @blueyvatar/web exec vitest run lib/integration-guides.test.ts`. Expected: FAIL (files missing).
- [ ] **Step 3: Write the guides** from the spec's per-platform facts, each with the five sections. Discourse refresh: Rails console (`./launcher enter app`, `rails c`, `SiteSetting.gravatar_base_url = "img.blueyvatar.com"`) and `DISCOURSE_GRAVATAR_BASE_URL` in `app.yml` with rebuild; caveat that Discourse stores the avatar once; "Limits" note: a large forum downloads every avatar from one server, so ask the owner to use the site's own limit or contact support.
- [ ] **Step 4: Run** the test and `corepack pnpm --filter @blueyvatar/web build` (build-docs must accept the new names). Expected: PASS.
- [ ] **Step 5: Commit** `docs: GitLab, Gitea, Forgejo and Redmine guides; clearer Discourse steps`.

### Task 2: "Show avatars on your site" hub on /docs

**Files:**
- Modify: `apps/web/app/docs/page.tsx` (or `components/DocsView.tsx` if the index renders there), `apps/web/lib/copy/` (public copy file), `apps/web/lib/docs.ts` if a guide list helper belongs there
- Test: `apps/web/lib/docs-hub.test.ts`

**Interfaces:**
- Consumes: guide pages from Task 1 (`docPage('integrations-<name>')`).
- Produces: `GUIDE_HUB: { slug: string; name: string; change: string; minutes: number }[]` in the copy file (8 entries: html, wordpress, ghost, discourse, gitlab, gitea, forgejo, redmine).

- [ ] **Step 1: Write failing tests:** `hub lists every guide` (`GUIDE_HUB` slugs equal `INTEGRATIONS` from build-docs.mjs, read as text); `every hub entry links to an existing doc page` (`docPage('integrations-' + slug)` is defined); `every entry is under 5 minutes`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** a section titled "Show avatars on your site" at the top of `/docs` (above the API reference), one row per guide: name (link), the one-line change, "About N minutes". Follow existing /docs styles; links are tap targets `min-h-11`.
- [ ] **Step 4: Run** the tests, web typecheck, web unit suite, web build. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): guide hub on /docs`, add `changelog.d/` fragment, push `docs/integration-guides`, open PR "Integration guides and /docs guide hub". Merge when green.

### Task 3: Issues for later work

- [ ] Create GitHub issues (check `gh issue list --search` first to avoid duplicates), each with the research facts from the spec and the owner decision "later round":
  - "phpBB extension: point Gravatar at BlueyVatar" (hook `core.get_gravatar_url_after`; phpBB sends SHA-256)
  - "Flarum and NodeBB plugins for BlueyVatar avatars"
  - "Zulip: configurable Gravatar URL (upstream patch)" (`zerver/lib/avatar.py` hard-codes secure.gravatar.com; MD5)
  - "Discourse plugin with a visible BlueyVatar setting" (avoid the hidden setting and console)
  - "Mobile SDKs (Swift, Kotlin)" (mobile apps can use image URLs today)
- [ ] Comment on #295 that Gitea and Forgejo federated avatar mode needs DNS SRV discovery.

### Task 4: Over-limit with d=404 returns 404

**Files:**
- Modify: `apps/delivery/src/routes/avatar.ts:60`, `apps/delivery/src/openapi.ts` (over-limit description), `docs/superpowers/specs/2026-11-27-admin-settings-design-v1.md` (note the reversed call)
- Test: `apps/delivery/src/routes/over-limit.test.ts`

- [ ] **Step 1: Write failing tests:** `over limit with d=404 returns 404 on /avatar` (anonymous limit 1; 2nd `/avatar/<hash>?d=404` is 404 with the same JSON body and headers as a normal `d=404` miss, plus `x-over-limit: 1` and `retry-after`); same for `/u/<handle>?d=404`; existing test `over limit ignores d and redirects` keeps passing for `d=<url>` and styles (rename to `over limit ignores d styles and URLs`).
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement** in `serveAvatar`: when `e.overLimit` and the raw `d` query equals `404`, answer like a `d=404` miss (`fail(c, 404, 'not_found', ...)` with `cache-control: private, max-age=300`) plus the over-limit headers; otherwise the existing redirect.
- [ ] **Step 4: Run** the file, delivery suite, tsc. Expected: PASS.
- [ ] **Step 5: Commit** `fix(delivery): over-limit requests with d=404 get 404, not the over-limit picture`, add `changelog.d/` fragment, push branch `fix/over-limit-d404` (from origin/main, separate worktree), open PR. Merge when green.
