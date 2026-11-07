-- MD5 of the normalized email, for older Gravatar clients (spec section 13, item 2, issue #61).
-- Computed at link time from the same trimmed, lowercased string as the SHA256. Links made before
-- this migration have no MD5: it cannot be derived from a SHA256, and raw emails are never stored.
-- Those links get one the next time their owner verifies the email again.

BEGIN;

ALTER TABLE email_links ADD COLUMN IF NOT EXISTS email_md5 char(32) CHECK (email_md5 ~ '^[0-9a-f]{32}$');
CREATE UNIQUE INDEX IF NOT EXISTS email_links_md5_idx ON email_links (email_md5) WHERE email_md5 IS NOT NULL;

-- A pending verification carries the MD5 until the code is confirmed. Null for codes sent before this migration.
ALTER TABLE email_codes ADD COLUMN IF NOT EXISTS email_md5 char(32) CHECK (email_md5 ~ '^[0-9a-f]{32}$');

COMMIT;
