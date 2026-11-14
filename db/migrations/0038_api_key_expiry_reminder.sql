-- Tracks the one expiry reminder email per API key (issue #236). Null means no reminder was sent yet.
-- Keys with no expiry (Forever) never get one.
ALTER TABLE api_keys ADD COLUMN expiry_reminded_at timestamptz;
