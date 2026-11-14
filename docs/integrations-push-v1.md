# Adding an app to "Send your picture to apps" (v1)

The Integrations page (`/integrations`, issue #298) lets a signed-in person choose which atproto apps get their BlueyVatar default image as the app's profile picture. Each app is one entry in `apps/web/lib/push-apps.ts`. Adding an app is that entry and one test line. Nothing else changes.

## What you need before you write the entry

Take every fact from the app's published lexicon. If you cannot find the lexicon file, do not add the app: leave it as a next entry in this file.

| Field | Where it comes from |
| --- | --- |
| `collection` | The lexicon `id` of the profile record, for example `org.tangled.actor.profile`. The lexicon must say `"key": "literal:self"`, so the record key is `self`. |
| `avatar.maxBytes` | `maxSize` on the lexicon's `avatar` blob. |
| `avatar.mimes` | `accept` on the `avatar` blob. When the lexicon lists none, use PNG and JPEG, which BlueyVatar always produces. |
| `source` | The URL of the lexicon JSON you read. |
| `reach`, `note` | Plain sentences for the page: which apps show the picture, and any fallback behavior. |

The `avatar` field must be optional, so a record holding only `$type` and `avatar` is valid. That is the record BlueyVatar creates when the person agrees to create one.

## What follows from the entry

- The permission is `repo:<collection>?action=create&action=update` (`profileWriteScope` in `lib/oauth.ts`). Both actions are needed because the reference PDS checks `create` and `update` on every `putRecord` (issue #297).
- The scope is asked for only when the person ticks that app's box. Sign-in for everyone else is unchanged. Permission sets cannot span namespaces, so each app is its own consent step.
- The client metadata declares every entry's scope when `OAUTH_PUSH_APPS` is on (`declaredScope`). A scope that is not declared there cannot be requested.
- The image is shrunk to a square PNG or JPEG under `maxBytes` before upload.
- The write keeps every other field in the record, and checks the record's version (`swapRecord`), so a change made in the app in the meantime is never overwritten.
- A missing record is created only after the person says yes, and then holds only `$type` and `avatar`.
- Each app has its own row in `bsky_avatar_sync` (key: `did`, `app`), so choices, the saved previous picture, and the change log are per app.

## Checklist

1. Add the entry to `PUSH_APPS`.
2. Run `pnpm --filter @blueyvatar/web test` and fix `push-apps.test.ts` if it flags a missing field.
3. Add the app to the staging test in `docs/deploy.md` ("Avatar push permission").
4. Add a line to `CHANGELOG.md`.

## Entries

- Bluesky: `app.bsky.actor.profile`, PNG or JPEG, at most 1,000,000 bytes. Source: the lexicon in `bluesky-social/atproto` at commit `fe343a1b90c1de470a45b0469628a9e75e7d883f`.
- Tangled: `org.tangled.actor.profile`, record key `self`, `avatar` blob `maxSize` 1,000,000, no `accept` list. Read from <https://tangled.org/tangled.org/core/raw/master/lexicons/org/tangled/actor/profile.json> on 2026-11-14. Tangled's docs also name the older `sh.tangled.actor.profile` as a legacy record still in use. BlueyVatar writes only the current `org.tangled` record.

## Next entries

None yet. Candidates need a published profile lexicon with an optional `avatar` blob and record key `self`. Blacksky and Frontpage have no published answer on a profile record of their own (research memo for #246).
