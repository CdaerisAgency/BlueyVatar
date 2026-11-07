-- Moderation appeals (issue #172, spec section 9).
-- One appeal per takedown or suspension (UNIQUE on action_id). Stored data is the minimum needed: who appealed,
-- which audit-log action, their statement, and the decision. No email address, IP, or hash is kept here: the
-- outcome email goes to the address already held in notice_emails, and rows are deleted with the account.

BEGIN;

CREATE TABLE appeals (
  id            bigserial PRIMARY KEY,
  did           text NOT NULL,
  action_id     bigint NOT NULL UNIQUE REFERENCES admin_actions (id),
  statement     text NOT NULL CHECK (char_length(statement) BETWEEN 1 AND 2000),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'overturned')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_by    text,
  decision_note text,
  decided_at    timestamptz
);
CREATE INDEX appeals_did_idx ON appeals (did);
CREATE INDEX appeals_open_idx ON appeals (created_at) WHERE status = 'open';

-- Appeal decisions go in the same audit log as other moderation decisions.
ALTER TABLE admin_actions DROP CONSTRAINT IF EXISTS admin_actions_action_check;
ALTER TABLE admin_actions ADD CONSTRAINT admin_actions_action_check CHECK (action IN
  ('block_image', 'unblock_image', 'takedown', 'suspend', 'unsuspend', 'dismiss_report', 'appeal_upheld', 'appeal_overturned'));

COMMIT;
