# Avatar push permission

The Integrations page lets a signed-in person choose, per app, whether BlueyVatar pushes their default image to that app's profile record (issue #298; the apps are listed in `apps/web/lib/push-apps.ts`, and `docs/integrations-push-v1.md` explains how to add one). Each app needs its own permission, `repo:<collection>?action=create&action=update`, for example `repo:app.bsky.actor.profile?action=create&action=update`. Both actions are needed because the reference PDS checks `create` and `update` on every `putRecord` (issue #297). The permission is requested only when the person ticks that app's box. Sign-in for everyone else is unchanged and never carries it.

The page is behind `OAUTH_PUSH_APPS`, off by default. Turning it on adds the apps' scopes to the OAuth client metadata (`/oauth-client-metadata.json`), because a client can request only scopes its metadata declares, and every sign-in sends that metadata to the authorization server. The permission spec does not say whether Bluesky's authorization server lets a third-party client declare or request write access to an `app.bsky.*` collection, so test it before production.

| Setting | Where | Notes |
| --- | --- | --- |
| `OAUTH_PUSH_APPS` | web app secret (Infisical, then Fly) | `true` or `1` turns the page and the metadata scopes on. Unset or anything else leaves them off, and the page says pushing is not switched on. Read per request, so a restart is enough and no rebuild is needed. Remove it to roll back. It replaces `OAUTH_REQUEST_BSKY_PROFILE`, which asked for the permission at every sign-in and is no longer read. |

Turn it on in this order (owner steps; agents do not deploy):

1. Set it on staging only, with the staging web app's secrets.
2. Sign in on staging with the owner's account. Confirm sign-in still succeeds with the new metadata scope list.
3. On `/integrations`, tick Bluesky and choose Save. Confirm the consent screen lists the profile permission for `app.bsky.actor.profile` (this is the check that Bluesky's authorization server lets a third-party app request it), grant it, and confirm the page offers "Turn on pushing to Bluesky". Turn it on, then confirm the picture changes on the profile and the rest of the profile is unchanged. Use "Restore my previous Bluesky picture" on the Avatars page.
4. Repeat with an account hosted on a non-Bluesky server, and with an account that has no `app.bsky.actor.profile` record yet. The page must ask before creating one, and the created record must hold only `$type` and `avatar`.
5. Tick Tangled with an account that has Tangled records and confirm its picture changes and its other profile fields stay.
6. Untick a box and confirm later default-image changes no longer reach that app, and that the record keeps its picture.
7. Only after steps 2 to 6 pass, set it on production.

A later sign-in replaces the session and drops the app permissions, so a ticked box then shows "BlueyVatar no longer holds the permission" with a way to allow it again.

The migration `db/migrations/0033_bsky_avatar_sync.sql` added the per-account state, the saved previous avatar, and an insert-only log of every change to a profile. `db/migrations/0039_avatar_push_apps.sql` makes both tables per app (`app` column, primary key `did, app`), adds `enabled`, `may_create`, and `consent_started_at`, and starts every existing row switched off. The tables keep their names so the account export and deletion code keeps working.
The account data export lists both tables for the signed-in person only: the switch and previous avatar reference, and the change log (action and image references with times, no account ID or row ids). Account deletion removes them.
