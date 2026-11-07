-- Web admin page and moderation audit log (issue #145, spec section 9).

BEGIN;

-- Every moderation decision, whether made on the admin page or with the ops CLI. Rows are only ever inserted.
-- actor: the admin DID for web actions, or the operator name for CLI actions.
CREATE TABLE admin_actions (
  id          bigserial PRIMARY KEY,
  actor       text NOT NULL,
  action      text NOT NULL CHECK (action IN
                ('block_image', 'unblock_image', 'takedown', 'suspend', 'unsuspend', 'dismiss_report')),
  target_did  text,
  target_cid  text,
  report_id   bigint,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_actions_target_idx ON admin_actions (target_did, created_at DESC);
CREATE INDEX admin_actions_created_idx ON admin_actions (created_at DESC);

-- Admin sign-ins. The cookie holds a random token; only its SHA256 is stored. Sessions are short lived.
CREATE TABLE admin_sessions (
  token_hash  char(64) PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  did         text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX admin_sessions_did_idx ON admin_sessions (did, expires_at);

-- Accepted one-time codes, so a code cannot be used twice.
CREATE TABLE admin_totp_used (
  did        text NOT NULL,
  step       bigint NOT NULL,
  used_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (did, step)
);

-- Operator suspensions. The images of a suspended account are blocked with kind 'suspension', so lifting
-- the suspension restores exactly those and leaves takedowns in place.
CREATE TABLE account_suspensions (
  did           text PRIMARY KEY,
  reason        text NOT NULL,
  suspended_by  text NOT NULL,
  suspended_at  timestamptz NOT NULL DEFAULT now(),
  lifted_at     timestamptz,
  lifted_by     text
);

-- Why an image is blocked: a plain block, a takedown, or part of an account suspension.
ALTER TABLE blocked_images ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'block'
  CHECK (kind IN ('block', 'takedown', 'suspension'));

COMMIT;
