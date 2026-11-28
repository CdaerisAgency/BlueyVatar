# Admin-set limits and over-limit avatar Implementation Plan v1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner set free and paid limits, image sizes, and cross-origin profile access in `/admin/settings`, live within about a minute, and serve an admin-uploaded avatar (never a broken image) to image requests over a limit.

**Architecture:** A typed settings catalog in `packages/core` with defaults, floors and ceilings; a `site_settings` table plus `site_assets` for the over-limit image; a shared `SettingsCache` that both apps refresh every 60 s and read synchronously. Delivery threads the snapshot into entitlement, params, and the profile gate, and turns image-request 429s into a redirect to `/default/over-limit/...`. Web gets an admin page, live public copy, and live included volumes.

**Tech Stack:** TypeScript, pnpm (`corepack pnpm`), Hono (delivery), Next.js 16 (web), Postgres via `pg`, sharp, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-27-admin-settings-design-v1.md`

## Global Constraints

- Setting keys, defaults, floors, ceilings (verbatim from the spec):
  - `limits.anonymousDaily` 100, floor 50, ceiling 1,000,000
  - `limits.free.keyedDaily` 1,000, floor 100, ceiling 10,000,000
  - `limits.plus.keyedMonthly` 50,000, floor 1,000, ceiling 100,000,000
  - `limits.business.keyedMonthly` 1,000,000, floor 10,000, ceiling 1,000,000,000
  - `sizes.free.maxSize` 512, `sizes.plus.maxSize` 1024, `sizes.business.maxSize` 2048, each floor 64, ceiling 2048
  - `embeds.profileAccess` `{ anonymous: false, free: false, plus: true, business: true }`
- Enterprise is never editable (stays 2048, hovercards true, contract overage).
- Refresh interval env `SETTINGS_REFRESH_MS`, default 60000. Public pages that show limits: `revalidate = 300`.
- Over-limit redirect: `302` to `/default/over-limit/{size}.{fmt}`, `cache-control: private, max-age=300`, headers `x-over-limit: 1` and `retry-after`. JSON (`json=true`) and data endpoints keep `429`.
- Over-limit upload: PNG, JPEG or WebP, at most 2 MB, square-cropped, re-encoded with sharp (metadata stripped).
- Paid volume fields carry the admin note "Display and usage alerts only. Not billed yet."
- Admin form footer copy: "Changes reach every server within about a minute."
- U.S. English, no em-dashes; web copy lives in `apps/web/lib/copy*`.
- Migration file `db/migrations/0046_site_settings.sql`, wrapped in BEGIN/COMMIT.
- New docs get a `-v1` suffix; the PR adds one `changelog.d/` fragment.
- Build `packages/core`, `packages/hovercards`, `packages/avatar` before `-r typecheck`/`-r test`. If `corepack pnpm` refuses on version, set `pnpm_config_pm_on_fail=ignore` for the shell.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **One bad row in `site_settings`** (hand-edited, or from an older catalog) must not change any other setting or crash startup. Test: Task 1 `ignores one bad row and keeps the rest`.
2. **Delivery starts before migration 0046 has run** (table missing). It must serve defaults and the silhouette, not crash. Test: Task 4 `missing table serves defaults` (pg loader treats SQLSTATE 42P01 as no rows).
3. **Lowering the anonymous limit below a viewer's current count** must take effect on that viewer's next request, not after their window resets. Test: Task 4 `a lowered limit applies on the next hit`.
4. **`d=404` or `d=<url>` on an over-limit image request.** The viewer still gets the over-limit avatar (the limit is about our serving cost, not the site's fallback). Test: Task 5 `over limit ignores d and redirects to the over-limit avatar`.
5. **Admin enters "1,000" with a comma or spaces.** Accept digits with commas, spaces or underscores; refuse anything else with a message naming the allowed range. Test: Task 6 `parses grouped digits and refuses junk`.

---

### Task 1: Settings catalog in core

**Files:**
- Create: `packages/core/src/settings.ts`
- Modify: `packages/core/src/tiers.ts:75-78`, `packages/core/src/usage-window.ts:41`, `packages/core/src/params.ts:52-59`, `packages/core/src/index.ts` (export)
- Test: `packages/core/src/settings.test.ts`

**Interfaces:**
- Produces:
  - `interface SiteSettings { anonymousDaily: number; keyedDaily: { free: number }; keyedMonthly: { plus: number; business: number }; maxSize: { free: number; plus: number; business: number }; profileAccess: { anonymous: boolean; free: boolean; plus: boolean; business: boolean } }`
  - `type SettingKey` (the 8 keys above), `interface SettingDef { key: SettingKey; kind: 'int' | 'access'; label: string; min?: number; max?: number; default: number | SiteSettings['profileAccess']; note?: string }`, `const SETTING_DEFS: readonly SettingDef[]`
  - `const DEFAULT_SETTINGS: SiteSettings`
  - `type SettingRow = { key: string; value: unknown }`
  - `validateSetting(key: string, value: unknown): { ok: true; key: SettingKey; value: number | SiteSettings['profileAccess'] } | { ok: false; error: string }`
  - `parseSettings(rows: SettingRow[]): { settings: SiteSettings; rejected: string[] }`
  - `entitlementsFor(value: unknown, settings: SiteSettings = DEFAULT_SETTINGS): Entitlements` (overrides `maxSize`, `keyedDaily` for free, `keyedMonthly` for plus/business, `hovercards` for free/plus/business)
  - `includedVolume(tier: Tier | string, settings: SiteSettings = DEFAULT_SETTINGS): Included`
  - `ParseOptions` gains `settings?: SiteSettings`
  - `ANONYMOUS_DAILY_LIMIT` stays, with `/** @deprecated use SiteSettings.anonymousDaily */`

- [ ] **Step 1: Write failing tests** in `settings.test.ts`:
  - `defaults match today's tiers`: `entitlementsFor('plus', DEFAULT_SETTINGS)` deep-equals `ENTITLEMENTS.plus`; same for free, business, enterprise.
  - `applies an in-range row`: `parseSettings([{ key: 'limits.anonymousDaily', value: 5000 }]).settings.anonymousDaily === 5000`, `rejected` empty.
  - `rejects below floor and above ceiling`: values 49 and 1_000_001 for `limits.anonymousDaily` are rejected; the setting stays 100; `rejected` names the key.
  - `rejects unknown key and wrong type`: `{ key: 'limits.gold', value: 1 }`, `{ key: 'sizes.free.maxSize', value: '512' }`, `{ key: 'sizes.free.maxSize', value: 512.5 }` all rejected.
  - `ignores one bad row and keeps the rest`: rows `[{anonymousDaily: 1e9}, {sizes.plus.maxSize: 768}]` yields anonymousDaily 100 and plus maxSize 768.
  - `access must have exactly the four booleans`: missing `anonymous` or a string value is rejected.
  - `entitlementsFor applies overrides and keeps enterprise fixed`: with `maxSize.free = 256`, `profileAccess.free = true`: free maxSize 256, hovercards true; enterprise unchanged.
  - `includedVolume reads settings`: plus with `keyedMonthly.plus = 75_000` gives `{ volume: 75000, per: 'month' }`.
  - `parseAvatarParams clamps to the settings max size`: `s=1024` with tier free and `maxSize.free = 256` gives size 256 and `adjusted` includes `s`.
- [ ] **Step 2: Run** `corepack pnpm --filter @blueyvatar/core exec vitest run src/settings.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the interfaces above. Integers only for `int` kind (`Number.isSafeInteger`). `parseAvatarParams` uses `entitlementsFor(opts.tier, opts.settings)`.
- [ ] **Step 4: Run** the new test plus `corepack pnpm --filter @blueyvatar/core test` and `typecheck`. Expected: PASS, existing tests unchanged.
- [ ] **Step 5: Commit** `feat(core): settings catalog with defaults, ranges, and settings-aware entitlements`.

### Task 2: SettingsCache in core

**Files:**
- Create: `packages/core/src/settings-cache.ts`
- Test: `packages/core/src/settings-cache.test.ts`

**Interfaces:**
- Consumes: `SiteSettings`, `SettingRow`, `parseSettings`, `DEFAULT_SETTINGS` (Task 1).
- Produces: `class SettingsCache { constructor(load: (() => Promise<SettingRow[]>) | null, opts?: { refreshMs?: number; onError?: (err: unknown) => void; onRejected?: (keys: string[]) => void }); start(): Promise<void>; refresh(): Promise<void>; current(): SiteSettings; stop(): void }`. `start()` loads once (errors go to `onError`, snapshot stays defaults) then sets an `unref()`ed interval. `load === null` serves `DEFAULT_SETTINGS` forever.

- [ ] **Step 1: Write failing tests:** `serves defaults before start`; `start loads rows`; `refresh applies a change`; `failed refresh keeps the last snapshot and calls onError`; `null loader serves defaults`; `stop clears the timer` (fake timers); `rejected keys reach onRejected`.
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and core typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): SettingsCache with background refresh and last-good fallback`.

### Task 3: Migration and web settings store with audit

**Files:**
- Create: `db/migrations/0046_site_settings.sql`
- Create: `apps/web/lib/admin/site-settings.ts`
- Modify: `apps/web/lib/admin/moderation.ts:3-6` (add `'settings_change' | 'asset_change'` to `AdminAction`)
- Test: `apps/web/lib/admin/site-settings.test.ts`

**Interfaces:**
- Consumes: `validateSetting`, `SettingRow`, `SettingKey` (Task 1); `recordAction`, `inTx` from `moderation.ts`.
- Produces:
  - `listSettingRows(q: Pick<pg.Pool, 'query'>): Promise<SettingRow[]>` (returns `[]` on SQLSTATE `42P01`)
  - `saveSettings(pool: pg.Pool, actor: string, changes: { key: string; value: unknown }[]): Promise<{ ok: true; changed: SettingKey[] } | { ok: false; errors: Record<string, string> }>`: validates all first; if any invalid, writes nothing; otherwise in one `inTx` upserts each changed key (`updated_by = actor`) and calls `recordAction(c, actor, 'settings_change', { detail: { key, before, after } })` per changed key. Unchanged values are skipped.
  - `resetSetting(pool: pg.Pool, actor: string, key: SettingKey): Promise<void>`: deletes the row and audits `detail: { key, before, after: 'default' }`.
  - `getAssetMeta(q, name: 'over_limit_avatar'): Promise<{ sha256: string; width: number; height: number; mime: string; updatedAt: Date } | null>`
  - `putOverLimitAsset(pool, actor, image: Buffer): Promise<{ ok: true } | { ok: false; error: string }>` and `removeOverLimitAsset(pool, actor): Promise<void>`, each audited as `asset_change` with `detail: { name, before: sha|null, after: sha|null }`.

- [ ] **Step 1: Write the migration:** tables `site_settings` and `site_assets` exactly as in the spec "Data" section; drop and recreate the `admin_actions` action CHECK with the full list from `0043_effect_offers.sql:46-50` plus `'settings_change'`, `'asset_change'`.
- [ ] **Step 2: Write failing tests** (Postgres suite, skipped without `DATABASE_URL`, following existing `*.test.ts` pg patterns): `saves changed keys and audits each`; `writes nothing when any value is invalid`; `skips unchanged values`; `reset deletes the row and audits`; `listSettingRows returns [] when the table is missing` (mock a query rejecting with `{ code: '42P01' }`, runs without DB).
- [ ] **Step 3: Run** `corepack pnpm --filter @blueyvatar/web exec vitest run lib/admin/site-settings.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the store. `putOverLimitAsset` uses sharp: reject input over 2 MB or not PNG/JPEG/WebP (check sharp `metadata().format`), center-crop to square, cap edge at 1024, output PNG, compute sha256.
- [ ] **Step 5: Add an upload test** `rejects non-image and oversize input; stores a square PNG` (no DB needed if you mock the query fn).
- [ ] **Step 6: Run** the file, the migrate duplicate-number test (`corepack pnpm --filter ./tools/migrate test`), web typecheck. Expected: PASS.
- [ ] **Step 7: Commit** `feat(db,web): site_settings and site_assets tables with an audited settings store`.

### Task 4: Delivery reads live settings

**Files:**
- Create: `apps/delivery/src/site-settings.ts`
- Modify: `apps/delivery/src/app.ts:23-37` (`AppDeps.settings`), `apps/delivery/src/server.ts` (build and start the cache), `apps/delivery/src/entitlement.ts:19-64`, `apps/delivery/src/context.ts:46-64`, `apps/delivery/src/routes/avatar.ts:41-46`, `apps/delivery/src/routes/profile.ts:27-31`, `apps/delivery/src/alerts.ts:93`, `apps/delivery/src/test/harness.ts:30-56`, `apps/delivery/src/obs.ts` (metric)
- Test: `apps/delivery/src/routes/settings.test.ts`

**Interfaces:**
- Consumes: `SettingsCache`, `SiteSettings`, `entitlementsFor(tier, settings)` (Tasks 1-2).
- Produces:
  - `AppDeps.settings: { current(): SiteSettings }` (harness default: `{ current: () => DEFAULT_SETTINGS }`; `baseDeps({ settings })` overrides).
  - `pgSettingRows(pool: pg.Pool): () => Promise<SettingRow[]>` in `site-settings.ts` (42P01 means `[]`, logged once per refresh as a warning).
  - `checkEntitlement(...)` takes `settings: SiteSettings` and uses `settings.anonymousDaily` and `entitlementsFor(tier, settings)`. Its result gains `overLimit: boolean` on 429 so Task 5 can tell a limit 429 from others.
  - Metric `settings_refresh_failures_total`.

- [ ] **Step 1: Write failing tests** in `routes/settings.test.ts` using the harness:
  - `anonymous limit comes from settings`: `anonymousDaily = 3`; the 4th `/avatar/<hash>?json=true` from one IP is 429.
  - `a lowered limit applies on the next hit`: 5 hits at limit 10, then the settings object changes to 3, then the next hit is 429.
  - `max size comes from settings`: free key, `maxSize.free = 128`, `s=512` gives `x-adjusted-params` containing `s` and a 128 size in the redirect path.
  - `profile access follows settings`: cross-origin `/profile/<id>` with no key is 403 by default and 200 when `profileAccess.anonymous = true`; free key 403 by default and 200 when `profileAccess.free = true`.
  - `403 message has no plan names`: body message is `Cross-origin profile access depends on your plan. See https://blueyvatar.com/pricing`.
  - `alerts use the live included volume`: `keyedMonthly.plus = 10` fires the 80 percent alert at 8.
  - `missing table serves defaults`: `pgSettingRows` with a pool whose query rejects `{ code: '42P01' }` resolves `[]`.
- [ ] **Step 2: Run** `corepack pnpm --filter @blueyvatar/delivery exec vitest run src/routes/settings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `server.ts`: `new SettingsCache(pool ? pgSettingRows(pool) : null, { refreshMs: Number(process.env.SETTINGS_REFRESH_MS ?? 60000), onError: (e) => { log.warn('settings refresh failed', ...); metrics.inc('settings_refresh_failures_total') } })`, `await start()` before listening. Pass `settings.current()` into `parseAvatarParams` (`opts.settings`), the profile gate (`e.keyKind === null ? s.profileAccess.anonymous : entitlementsFor(e.tier, s).hovercards`), and alerts.
- [ ] **Step 4: Run** the new file and the full delivery suite and typecheck. Expected: PASS (existing 429 tests still pass with defaults).
- [ ] **Step 5: Commit** `feat(delivery): read limits, sizes and profile access from live site settings`.

### Task 5: Over-limit redirect and over-limit image route

**Files:**
- Create: `apps/delivery/src/over-limit-asset.ts`, `apps/delivery/src/routes/over-limit.ts`
- Modify: `apps/delivery/src/routes/avatar.ts:40-46`, `apps/delivery/src/app.ts` (mount; `AppDeps.overLimitAsset`), `apps/delivery/src/server.ts`, `apps/delivery/src/openapi.ts:86,179`, `apps/delivery/src/test/harness.ts`
- Test: `apps/delivery/src/routes/over-limit.test.ts`

**Interfaces:**
- Consumes: `checkEntitlement` result with `overLimit` (Task 4); `deps.resize`; `defaultSvg` from `routes/default.ts`.
- Produces:
  - `AppDeps.overLimitAsset: { get(): Promise<{ bytes: Buffer; mime: string; sha256: string } | null> }` (harness default returns `null`).
  - `pgOverLimitAsset(pool: pg.Pool, ttlMs = 60000)` in `over-limit-asset.ts`: reads `site_assets` row `over_limit_avatar`, caches bytes in memory for `ttlMs`, 42P01 means `null`.
  - Route `GET /default/over-limit/:file`, file regex identical to `/default/:style/:file`.

- [ ] **Step 1: Write failing tests:**
  - `over-limit image request redirects to the over-limit avatar`: `anonymousDaily = 1`; 2nd `/avatar/<hash>?s=200` is 302 to `/default/over-limit/200.png`, with `cache-control: private, max-age=300`, `x-over-limit: 1`, and `retry-after`.
  - `json over limit stays 429`: same with `json=true` is 429 JSON.
  - `over limit ignores d and redirects to the over-limit avatar`: `d=404` and `d=https://allowed.example/x.png` both give the 302 above.
  - `format kept when the plan allows it, else png`: anonymous `fmt=webp` over limit redirects to `.png`.
  - `size snapped to the free max`: `s=2000` over limit redirects to `/default/over-limit/512.png` (default free max).
  - `serves the uploaded asset`: with `overLimitAsset.get` returning a PNG, `GET /default/over-limit/64.png` is 200 `image/png`, `cache-control: public, max-age=86400`, 64x64 (check with sharp metadata).
  - `serves the silhouette with no upload`: same request with `get` returning `null` is 200 and byte-equal to `/default/mp/64.png?seed=over-limit`.
  - `rejects bad file names`: `/default/over-limit/abc.gif` is 400.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement.** In `serveAvatar`, before `fail` on `!e.ok`: if `e.overLimit` and `json` param is not `true`, compute size (`s` parsed, clamped to `entitlementsFor('free', settings).maxSize`, default 80) and format (requested if allowed for `e.tier ?? 'free'`, else `png`), set headers, and `c.redirect(...)`. Make `openapi.ts:86,179` describe the rule without numbers or plan names, and document `x-over-limit` and the new route.
- [ ] **Step 4: Run** the file, full delivery suite, typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(delivery): over-limit image requests get the admin avatar instead of a broken image`.

### Task 6: Admin settings page

**Files:**
- Create: `apps/web/app/admin/settings/page.tsx`, `apps/web/app/admin/settings/actions.ts`, `apps/web/app/admin/settings/over-limit/route.ts` (admin-only preview of the stored image), `apps/web/lib/admin/settings-form.ts`
- Modify: `apps/web/app/admin/AdminBits.tsx:14-15` (nav link "Settings"), `apps/web/app/admin/audit/page.tsx` (one-line summary), `apps/web/lib/copy/` admin copy file (labels, notes, footer)
- Test: `apps/web/lib/admin/settings-form.test.ts`, `apps/web/lib/admin/admin.test.ts` (extend)

**Interfaces:**
- Consumes: `SETTING_DEFS`, `validateSetting` (Task 1); `listSettingRows`, `saveSettings`, `resetSetting`, `getAssetMeta`, `putOverLimitAsset`, `removeOverLimitAsset` (Task 3); `requireAdmin`, `limited`, `AdminPage` (existing).
- Produces:
  - `parseIntField(raw: string): number | null` in `settings-form.ts` (accepts digits with `,`, spaces, `_`; returns null otherwise).
  - `formChanges(form: FormData): { key: string; value: unknown }[]` (int fields via `parseIntField`; access as four checkboxes `embeds.profileAccess.<who>`).
  - `crossPlanWarnings(s: SiteSettings): string[]` (free above plus, plus above business, for maxSize; free daily times 30 above plus monthly).
  - `auditSummary(detail: unknown): string | null` returning `key: before → after`.
  - Server actions `saveSettingsAction(form)`, `resetSettingAction(form)`, `uploadOverLimitAction(form)`, `removeOverLimitAction()`, each `requireAdmin()` + `limited(['adminAction.did','adminAction.ip'], a.did)` + redirect to `/admin/settings?msg=...`.

- [ ] **Step 1: Write failing tests:** `parses grouped digits and refuses junk` (`"1,000"`→1000, `"1 000"`→1000, `"1_000"`→1000, `"1e3"`, `"-5"`, `"12.5"`, `""`→null); `formChanges reads ints and access checkboxes`; `crossPlanWarnings flags free above plus`; `auditSummary formats before and after`; `settings page is admin-only` (extend admin.test.ts the way other admin pages are checked: non-admin gets 404).
- [ ] **Step 2: Run** the files. Expected: FAIL.
- [ ] **Step 3: Implement** the page following `app/admin/effects/page.tsx`: one form with a number input per int setting (current value, default, "Allowed: min to max", the paid note), four checkboxes for profile access, Save, per-field Reset buttons, warnings list, footer copy; an over-limit section with preview (from the admin-only route, `nosniff` and CSP sandbox like the bug-report screenshot route), file input (`accept="image/png,image/jpeg,image/webp"`), Upload and Remove. Error messages from `saveSettings` show next to fields. All tap targets `min-h-11`. After an upload or removal, purge `https://img.blueyvatar.com/default/over-limit/*` if the web app has Cloudflare purge configured (grep for the existing purge helper and its env vars); if not, skip (the 24-hour cache applies, as the spec allows).
- [ ] **Step 4: Run** the files, web typecheck, web unit suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): admin settings page for limits, sizes, profile access and the over-limit avatar`.

### Task 7: Web reads live settings (copy, keys, billing)

**Files:**
- Create: `apps/web/lib/site-settings.ts`
- Modify: `apps/web/lib/copy/public.ts:38-40`, `apps/web/app/pricing/page.tsx`, `apps/web/app/gravatar-alternative/page.tsx:58`, `apps/web/lib/keys.ts:115`, `apps/web/app/account/billing/LicenseUsage.tsx:19`, `apps/web/app/account/keys/page.tsx:33`, docs: `docs/deploy/` web env file (add `SETTINGS_REFRESH_MS`), `.env.example`, `changelog.d/` fragment
- Test: `apps/web/lib/site-settings.test.ts`, update `apps/web/lib/gravatar-pages.test.ts` and any pricing copy test

**Interfaces:**
- Consumes: `SettingsCache`, `entitlementsFor`, `includedVolume` (Tasks 1-2); `listSettingRows` (Task 3); `getPool()` from `apps/web/lib/pool.ts`.
- Produces:
  - `getSiteSettings(): Promise<SiteSettings>` (module singleton on `globalThis.__bvSettings`, started on first call; null pool means defaults).
  - `formatVolume(n: number): string` ("1,000", "50,000", "1 million", "2.5 million").
  - Copy functions in `copy/public.ts` that take `SiteSettings` and return the plan lines (replacing the three hardcoded strings).

- [ ] **Step 1: Write failing tests:** `formatVolume` cases above; `plan copy uses settings` (with `keyedMonthly.plus = 75_000` the Plus line says "75,000 requests a month"); `gravatar comparison uses live sizes`; `getSiteSettings serves defaults without a database`.
- [ ] **Step 2: Run** the files. Expected: FAIL.
- [ ] **Step 3: Implement.** Pricing and Gravatar pages `export const revalidate = 300` and read `await getSiteSettings()`. Keys and billing pages pass settings into `entitlementsFor` / `includedVolume`.
- [ ] **Step 4: Run** web typecheck, web unit suite, and `-r build` (Next build must accept `revalidate` on these pages). Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): pricing, comparison, keys and billing pages read live limits`.

### Task 8: PR

- [ ] Rebase on `origin/main`, run `-r typecheck` and `-r test` once, push `feat/admin-settings`, open PR "Admin-set limits and over-limit avatar" (ready for review) linking the spec. Merge when CI is green. Add the spec v15 note (limits are admin-set; table shows launch defaults) as a follow-up issue, not in this PR.
