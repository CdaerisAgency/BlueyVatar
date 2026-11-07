-- Per-account email notification preferences (issue #144).
--   * usage_alerts: the 80 and 100 percent usage messages (spec section 12).
--   * billing_notices: failed payment, grace expiry, and subscription cancellation messages (spec section 12.1).
-- No row means both are on. Security notices (claim revoked, email moved, key revoked) have no switch.
-- The indexer deletes the row when the account is deleted.

CREATE TABLE IF NOT EXISTS notification_prefs (
  did             text PRIMARY KEY,
  usage_alerts    boolean NOT NULL DEFAULT true,
  billing_notices boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
