# Admin-set limits and over-limit avatar: design v1

Date: 2026-11-27. Status: draft for owner approval. Project 1 of 4 in the integrations roadmap (then npm publish, embeds, guides).

## Why

The owner's goal for integrations is **reach**: BlueyVatar avatars seen on as many sites as possible. Today the free limit blocks that. Anonymous image loads are capped at 100 per day **per viewer IP** (`packages/core/src/tiers.ts:75`, enforced in `apps/delivery/src/entitlement.ts:27`). A reader browsing a busy forum, or a whole office behind one IP, burns through it in minutes and then sees broken images (HTTP 429). The owner wants to raise limits without redeploying, and to tune them as real costs become clear (the `tiers.ts` header already says every number is a placeholder).

## Goals

1. The owner edits these values in the admin portal, and they take effect within about a minute with no deploy:
   - Anonymous daily image limit (per viewer IP).
   - Per-plan keyed quotas: Free `keyedDaily`, Plus and Business `keyedMonthly`.
   - Per-plan max image size (`maxSize`).
   - Cross-origin profile and hovercard access: which plans may use it, and whether anonymous callers may.
2. A viewer over a limit on an **image** request gets an avatar, never a broken image. The owner uploads that "over-limit avatar" in the admin portal.
3. Every change is recorded in the existing admin audit log with who, when, the old value and the new value.
4. Public copy that states limits (pricing page, Gravatar comparison page, API docs and error messages) shows the live values.

## Non-goals

- Enterprise limits (stay contract-based in code).
- Editing prices, formats, TTL control, max keys, max images, QR codes, or verified-account counts. Those stay in `tiers.ts` for now; the settings structure must make adding them later a one-line change.
- Per-customer overrides (a license-level exception). Later, if needed.
- Moving enforcement to the Cloudflare edge (option C, rejected).
- Closing the existing "/img bypasses size caps" risk (spec v14 lines 306, 576). Separate issue.

## Anti-goals (would make this a failure even if it works)

- A typo in admin takes the site down or makes avatars free-for-all by accident. Every value has a floor and ceiling and is validated on save and on load.
- A database outage breaks avatar delivery. If settings cannot be read, delivery keeps the last good snapshot, or the code defaults if it never loaded one.
- JSON API callers (`json=true`, `/profile`, `/usage`) get an image when they asked for data. They keep getting `429` with `retry-after`, so developers can see and handle the limit.

## Approaches considered

- **A. Settings table in Postgres, in-memory snapshot refreshed every 60 s (chosen by owner).** No deploy to change a value, audited, and both web and delivery read the same table. Costs one small query per minute per machine. Values can be stale for up to 60 s.
- **B. Fly secrets or environment config.** Rejected: every change needs a redeploy, which goes against "set it from the admin portal".
- **C. Cloudflare edge rules.** Rejected: a second place where rules live, and the useful rate-limit features need a paid plan.

## Design

### Data

New migration `0046_site_settings.sql`:

- `site_settings(key text primary key, value jsonb not null, updated_by text not null, updated_at timestamptz not null default now())`. One row per setting. A missing row means "use the code default".
- `site_assets(name text primary key, image bytea not null, mime text not null, width int not null, height int not null, sha256 text not null, updated_by text not null, updated_at timestamptz not null default now())`. Holds the over-limit avatar under name `over_limit_avatar`.
- Extend the `admin_actions` action CHECK with `settings_change` and `asset_change` (same drop-and-recreate pattern as 0043).

### Settings catalog (`packages/core/src/settings.ts`)

A single typed catalog shared by web and delivery. Each entry has a key, a code default (today's value), a floor, a ceiling, and a label for the admin form.

| Key | Default | Floor | Ceiling |
| --- | --- | --- | --- |
| `limits.anonymousDaily` | 100 | 50 | 1,000,000 |
| `limits.free.keyedDaily` | 1,000 | 100 | 10,000,000 |
| `limits.plus.keyedMonthly` | 50,000 | 1,000 | 100,000,000 |
| `limits.business.keyedMonthly` | 1,000,000 | 10,000 | 1,000,000,000 |
| `sizes.free.maxSize` | 512 | 64 | 2048 |
| `sizes.plus.maxSize` | 1024 | 64 | 2048 |
| `sizes.business.maxSize` | 2048 | 64 | 2048 |
| `embeds.profileAccess` | `{ anonymous: false, free: false, plus: true, business: true }` | n/a | n/a |

(Enterprise keeps `embeds` true and 2048 in code.)

The catalog exports:

- `type SiteSettings` (resolved values).
- `DEFAULT_SETTINGS: SiteSettings`.
- `parseSettings(rows: { key: string; value: unknown }[]): { settings: SiteSettings; rejected: string[] }`. Applies each row on top of the defaults, rejecting (and naming) any key that is unknown or out of range, so one bad row can never break the others.
- `entitlementsFor(tier, settings = DEFAULT_SETTINGS)`. Same as today, with the editable fields overridden from `settings`. Existing callers keep working unchanged and get defaults; hot paths in delivery pass the live snapshot.
- `anonymousDailyLimit(settings)`.

### Reading settings (both apps)

`SettingsCache`: holds the current snapshot, loads it at startup, and refreshes every 60 s in the background (`SETTINGS_REFRESH_MS`, default 60000). Reads are synchronous (`cache.current()`), so request paths stay synchronous. On a failed refresh it logs a warning, increments a metric (`settings_refresh_failures_total`), and keeps the last good snapshot. Without `DATABASE_URL` (local dev, tests) it serves `DEFAULT_SETTINGS`.

- **Delivery**: build one `SettingsCache` in `server.ts`, add it to `AppDeps`, and thread `settings.current()` into `checkEntitlement`, `parseAvatarParams` and the `/profile` access gate. The batched rate limiter already takes the limit on every hit, so a new limit applies on the next request.
- **Web**: one cached loader (same 60 s refresh) used by the pricing copy, the Gravatar comparison page, the keys and billing pages, and the admin form.

### Over-limit behavior

For **image** requests only (`/avatar/:hash` and `/u/:id` without `json=true`): when an anonymous or keyed limit would return `429`, delivery instead answers `302` to `/default/over-limit/{size}.{fmt}`, with `cache-control: private, max-age=300` (short, so the viewer gets real avatars again once the window resets), and the headers `x-over-limit: 1` and `retry-after` (so developers can still see it in devtools). The rate-limit metric still counts it.

`GET /default/over-limit/:file` (same file pattern as `/default/:style/:file`) serves the uploaded `site_assets.over_limit_avatar`, resized with the existing `deps.resize`, with `public, max-age=86400`. A purge of that path runs when the owner uploads a new one (if the Cloudflare purge is configured; otherwise it updates within a day). With no upload, it serves the existing `mp` silhouette style.

JSON and data endpoints are unchanged: `429` with the JSON error body.

### Admin portal

New page `/admin/settings` (linked in the admin nav), following the effects page pattern: `requireAdmin()`, the `limited(['adminAction.did','adminAction.ip'])` guard, and a server action per form.

- One form with a number field per limit, showing the current value, the code default, and the allowed range. Saving validates against the catalog, writes only changed keys, and records one `settings_change` audit row per key with `detail: { key, before, after }`, all in one transaction (`inTx`).
- A "Reset to default" button per field deletes the row (audited the same way).
- An over-limit avatar section: upload (PNG, JPEG or WebP, at most 2 MB, square-cropped, re-encoded with sharp to strip metadata, the same approach as bug-report screenshots), a preview, and a remove button. Audited as `asset_change`.
- A line under the form: "Changes reach every server within about a minute."

### Public copy

Replace the hardcoded numbers with values formatted from the live settings:

- `apps/web/lib/copy/public.ts:38-40` (pricing).
- `apps/web/app/gravatar-alternative/page.tsx:58`.
- `apps/delivery/src/openapi.ts:86,179` and the `/profile` 403 message in `apps/delivery/src/routes/profile.ts:16-17`: make these describe the rule without numbers or plan names ("Cross-origin profile access depends on your plan; see /pricing"), so they never go stale.
- Spec v14 table 11.1: add a note that limits are admin-set and the table shows launch defaults (spec edit goes in the next spec version, v15).

## Constraints

- U.S. English, no em-dashes, copy in `apps/web/lib/copy*`.
- New docs get a `-v1` suffix; each PR adds a `changelog.d/` fragment.
- Migrations are `NNNN_snake_case.sql` wrapped in BEGIN/COMMIT; the next number is 0046.
- AGPL-3.0 for apps and packages/core (no license change).
- Merge with a merge commit when CI is green.

## Testing

- `parseSettings`: defaults, each key in range, below floor, above ceiling, unknown key, wrong type, one bad row does not affect the others.
- `entitlementsFor` with overrides; existing tiers tests still pass with defaults.
- `SettingsCache`: refresh applies a change; a failed refresh keeps the last snapshot and counts the metric; no DB serves defaults.
- Delivery: anonymous limit from settings (lower and raise it in a test); over-limit image request returns `302` to `/default/over-limit/...` with `x-over-limit`; `json=true` still returns `429`; `/default/over-limit` serves the uploaded asset or the silhouette; profile access follows `embeds.profileAccess`, including anonymous.
- Web admin: non-admin gets 404; save writes rows and audit entries in one transaction; out-of-range input is refused with a message; reset deletes the row; upload rejects wrong type and oversize.
- e2e: admin settings page renders and saves (behind the existing admin e2e setup, if one exists; otherwise unit tests on the action).

## Owner decision: paid included volumes

Plus and Business are metered and never blocked. Editing `limits.plus.keyedMonthly` and `limits.business.keyedMonthly` changes the **included volume customers see and when usage alerts fire**, for everyone, immediately. It has no billing effect today (overage billing is excluded from launch). Every reader of these values must use the live setting: `packages/core/src/usage-window.ts:42`, `apps/web/lib/keys.ts:115`, `apps/delivery/src/alerts.ts:93`, the billing usage UI (`apps/web/app/account/billing/LicenseUsage.tsx`), and alert emails. When overage billing is built, it must read the same setting. The admin form notes under these two fields: "Display and usage alerts only. Not billed yet."

## Calls made after the builder check (owner can override)

- **Public copy freshness:** pages that show limits revalidate every 5 minutes (`revalidate = 300`); no CDN purge on save. A change can take up to about 6 minutes to show on public pages.
- **Over-limit route cost:** `/default/over-limit/:file` is deliberately unmetered (it exists for visitors who are already over a limit). Size is snapped to the same size rules as `/default` and clamped to the Free max size; it relies on the 24-hour public cache.
- **Over-limit format:** keep the requested format when the caller's plan allows it, otherwise PNG.
- **Cross-field rules:** no hard rules. The admin form shows a warning (not a block) when a lower plan gets a higher value than the plan above it (for example Free max size above Plus).
- **Missing table:** if `site_settings` or `site_assets` does not exist yet (delivery deployed before migration 0046 runs), treat it as "no rows": defaults and the silhouette, with one warning log per refresh.
- **Anonymous:** "anonymous" means a request with no API key (`keyKind === null`), as opposed to a keyed Free caller.
- **Compatibility:** `entitlementsFor(value, settings = DEFAULT_SETTINGS)` keeps its first parameter and the `pro` alias; `ANONYMOUS_DAILY_LIMIT` stays as the exported default, marked deprecated in favor of the setting.
- **Audit viewer:** the existing `/admin/audit` list shows the two new action types with a one-line `key: before → after` summary from `detail`.

## Left to the builder

- Exact admin form layout and wording (follow the effects page).
- Whether `SettingsCache` lives in `packages/core` (shared) or is duplicated small in each app.
- The pricing copy formatter (thousands separators, "1 million").
