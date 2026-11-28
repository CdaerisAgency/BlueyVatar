-- Admin-editable limits and the over-limit avatar (admin settings design v1).
-- site_settings: one row per setting; a missing row means "use the code default". Values are validated against
--   packages/core/src/settings.ts on save and on load.
-- site_assets: named images. Holds the over-limit avatar under name 'over_limit_avatar' (square PNG, re-encoded by sharp).
-- admin_actions: adds settings_change and asset_change to the action CHECK (the detail column already exists, 0031).
BEGIN;

CREATE TABLE site_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE site_assets (
  name       text PRIMARY KEY,
  image      bytea NOT NULL,
  mime       text NOT NULL,
  width      int NOT NULL,
  height     int NOT NULL,
  sha256     text NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_actions DROP CONSTRAINT IF EXISTS admin_actions_action_check;
ALTER TABLE admin_actions ADD CONSTRAINT admin_actions_action_check CHECK (action IN
  ('block_image', 'unblock_image', 'takedown', 'suspend', 'unsuspend', 'dismiss_report', 'appeal_upheld', 'appeal_overturned',
   'acknowledge', 'rating_change', 'warn', 'escalate', 'reverse', 'comment', 'tag', 'reveal_image', 'divert', 'notice_sent',
   'effect_offer_create', 'effect_offer_change', 'effect_offer_end', 'settings_change', 'asset_change'));

COMMIT;
