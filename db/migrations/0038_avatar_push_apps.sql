-- Choosing per app whether blueyvatar pushes the default image to the app's profile record (issue #298).
-- The tables from 0033 keep their names so account export and deletion keep working; they now hold one row per
-- account and app instead of one row per account.

BEGIN;

-- app: the id from apps/web/lib/push-apps.ts. Existing rows were Bluesky.
-- enabled: the user ticked the app's box and finished its consent step. Defaults to off, so nothing is pushed on
--   the strength of the old auto_sync column: that feature was behind a setting that was never turned on.
-- may_create: the user agreed to create the app's profile record (holding only the picture) if the account has none.
--   Set with enabled, cleared when the box is unticked.
-- consent_started_at: set when the consent step starts, so the integrations page can finish the step when the
--   user comes back from the permission screen. Cleared when the app is turned on.
ALTER TABLE bsky_avatar_sync ADD COLUMN app text NOT NULL DEFAULT 'bluesky';
ALTER TABLE bsky_avatar_sync ADD COLUMN enabled boolean NOT NULL DEFAULT false;
ALTER TABLE bsky_avatar_sync ADD COLUMN may_create boolean NOT NULL DEFAULT false;
ALTER TABLE bsky_avatar_sync ADD COLUMN consent_started_at timestamptz;
ALTER TABLE bsky_avatar_sync DROP CONSTRAINT bsky_avatar_sync_pkey;
ALTER TABLE bsky_avatar_sync ADD PRIMARY KEY (did, app);
COMMENT ON COLUMN bsky_avatar_sync.auto_sync IS 'Superseded by enabled (0038). No longer read.';

ALTER TABLE bsky_avatar_log ADD COLUMN app text NOT NULL DEFAULT 'bluesky';

COMMIT;
