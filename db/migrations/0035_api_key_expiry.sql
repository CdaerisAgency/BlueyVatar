-- Optional expiry for API keys (issue #236). Null means the key never expires, so every existing key keeps working.
-- The delivery API rejects a key whose expires_at has passed with the error code key_expired.
ALTER TABLE api_keys ADD COLUMN expires_at timestamptz;
