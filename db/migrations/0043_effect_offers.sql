-- Admin-issued free effects (issue #308, part of #218). An offer makes one effect free for a window, for everyone, for
-- one plan, or for listed accounts. Offers only feed the `grants` argument of `canUse`; an avatar already rendered with
-- the effect is an ordinary image and keeps working after the offer ends.
--
-- effect: an effect id from lib/effects/catalog.ts (checked by the admin action, not here, so the catalog can grow).
-- audience: everyone, plan (plan_name says which), or accounts (rows in effect_offer_users with listed = true).
-- ends_at is exclusive. ended_at is set when an admin ends the offer early; the offer is then no longer active.
-- notify: send one email at the start and show a banner during the window. Off adds the effect quietly.
-- notify_done_at: set once every eligible account has been handled by the indexer job.
-- effect_offer_users: per-account data. listed marks a targeted account; emailed_at makes the one email idempotent;
--   dismissed_at hides the banner for that account. Exported and deleted with the account.
-- notification_prefs.offer_notices: the opt-out for the email (default on).

BEGIN;

CREATE TABLE effect_offers (
  id             bigserial PRIMARY KEY,
  effect         text NOT NULL,
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL CHECK (ends_at > starts_at),
  audience       text NOT NULL CHECK (audience IN ('everyone', 'plan', 'accounts')),
  plan_name      text CHECK (plan_name IN ('free', 'plus')),
  notify         boolean NOT NULL DEFAULT false,
  notify_done_at timestamptz,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  CHECK ((audience = 'plan') = (plan_name IS NOT NULL))
);
CREATE INDEX effect_offers_window_idx ON effect_offers (starts_at, ends_at) WHERE ended_at IS NULL;

CREATE TABLE effect_offer_users (
  offer_id     bigint NOT NULL REFERENCES effect_offers (id) ON DELETE CASCADE,
  did          text NOT NULL,
  listed       boolean NOT NULL DEFAULT false,
  emailed_at   timestamptz,
  dismissed_at timestamptz,
  PRIMARY KEY (offer_id, did)
);
CREATE INDEX effect_offer_users_did_idx ON effect_offer_users (did);

ALTER TABLE notification_prefs ADD COLUMN IF NOT EXISTS offer_notices boolean NOT NULL DEFAULT true;

ALTER TABLE admin_actions DROP CONSTRAINT IF EXISTS admin_actions_action_check;
ALTER TABLE admin_actions ADD CONSTRAINT admin_actions_action_check CHECK (action IN
  ('block_image', 'unblock_image', 'takedown', 'suspend', 'unsuspend', 'dismiss_report', 'appeal_upheld', 'appeal_overturned',
   'acknowledge', 'rating_change', 'warn', 'escalate', 'reverse', 'comment', 'tag', 'reveal_image', 'divert', 'notice_sent',
   'effect_offer_create', 'effect_offer_change', 'effect_offer_end'));

COMMIT;
