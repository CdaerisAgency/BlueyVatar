-- Web sign-in and email linking (spec sections 6 and 10.1).
-- Stores hold OAuth protocol state and hashed one-time codes only.
-- No raw email address is ever stored.

BEGIN;

-- Pending OAuth authorization requests, keyed by the client's state value.
CREATE TABLE oauth_state (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_state_created_idx ON oauth_state (created_at);

-- OAuth sessions (token sets and DPoP keys), keyed by the user's DID.
CREATE TABLE oauth_session (
  sub         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One pending email verification per DID. Only SHA256 hashes are stored.
CREATE TABLE email_codes (
  did          text PRIMARY KEY,
  email_hash   char(64) NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  -- SHA256 of did, email hash, and the 6-digit code.
  code_hash    char(64) NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  -- Masked address for the verify page (for example j***@e***.com).
  masked       text NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMIT;
