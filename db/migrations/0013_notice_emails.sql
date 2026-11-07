-- Stored primary email for notices (issue #113).
--   * notice_emails holds one address per account: the primary email, encrypted at rest with AES-256-GCM
--     (the `v1:` envelope used for OAuth tokens, key from TOKEN_ENCRYPTION_KEY). It is used only to mail
--     revocation notices (re-verification, #107) and to tell a previous owner their email moved (#105).
--   * email_hash must match the account's current primary link. The web store deletes the row when the
--     primary changes, is unlinked, or is taken by another account, and the indexer deletes it when the
--     account is deleted.
--   * email_codes.email_enc replaces the plaintext notify_to: the pending code now carries the address
--     encrypted, so confirming a code can store it and mail the previous owner without a raw address at rest.

BEGIN;

CREATE TABLE IF NOT EXISTS notice_emails (
  did         text PRIMARY KEY,
  email_hash  char(64) NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  email_enc   text NOT NULL CHECK (email_enc LIKE 'v1:%'),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notice_emails_hash_idx ON notice_emails (email_hash);

ALTER TABLE email_codes ADD COLUMN IF NOT EXISTS email_enc text;
-- Codes are short lived; drop any plaintext address still sitting in a pending row.
UPDATE email_codes SET notify_to = NULL WHERE notify_to IS NOT NULL;

COMMIT;
