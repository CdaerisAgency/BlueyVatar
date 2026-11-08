-- Keeping the Bluesky profile avatar in step with the default image (issue #241).

BEGIN;

-- One row per account that has used the feature. No row means the defaults: auto-sync on (it only acts once the
-- Bluesky profile permission has been granted).
-- previous_avatar: the avatar blob reference the Bluesky profile held before the last change, for "Restore my previous
-- Bluesky avatar". has_previous tells "no avatar before" (previous_avatar null) from "nothing to restore".
-- last_source_cid / last_sent_cid: the blueyvatar image blob and the Bluesky avatar blob from the last write, so the same
-- picture is never written twice. auto_notice_pending: show the "we changed your Bluesky avatar" notice until dismissed.
CREATE TABLE bsky_avatar_sync (
  did                 text PRIMARY KEY,
  auto_sync           boolean NOT NULL DEFAULT true,
  previous_avatar     jsonb,
  has_previous        boolean NOT NULL DEFAULT false,
  last_source_cid     text,
  last_sent_cid       text,
  auto_notice_pending boolean NOT NULL DEFAULT false,
  auto_count          integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Every change blueyvatar makes to a Bluesky profile. Rows are only ever inserted. Holds cids, never image bytes.
CREATE TABLE bsky_avatar_log (
  id          bigserial PRIMARY KEY,
  did         text NOT NULL,
  action      text NOT NULL CHECK (action IN ('set', 'auto_set', 'restore')),
  from_cid    text,
  to_cid      text,
  source_cid  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bsky_avatar_log_did_idx ON bsky_avatar_log (did, created_at DESC);

COMMIT;
