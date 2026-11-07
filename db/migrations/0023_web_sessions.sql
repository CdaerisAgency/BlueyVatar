-- Signed-in web sessions per account (issue #152). The session cookie names one row, so the account page can list
-- signed-in devices and sign them out. oauth_session holds one token set per DID and cannot tell devices apart.
--   * web_session: one row per sign-in. `device` is a coarse hint ("Firefox on Linux"), never the raw user agent or IP.
--   * session_floor: "sign out everywhere" sets revoked_at; cookies issued at or before it stop working, including
--     cookies from before this table existed.
-- Both tables are keyed by DID and are deleted with the account.

CREATE TABLE IF NOT EXISTS web_session (
  id           text PRIMARY KEY,
  did          text NOT NULL,
  device       text NOT NULL DEFAULT 'Unknown device',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS web_session_did_idx ON web_session (did, last_used_at DESC);

CREATE TABLE IF NOT EXISTS session_floor (
  did        text PRIMARY KEY,
  revoked_at timestamptz NOT NULL
);
