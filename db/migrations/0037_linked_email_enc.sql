-- Every linked email is stored encrypted so the owner can see each address in full (issue #223, owner decision 2026-11-14).
--   * email_links.email_enc holds the address in the `v1:` envelope (AES-256-GCM, key from TOKEN_ENCRYPTION_KEY),
--     the same encryption notice_emails.email_enc uses for the primary email.
--   * Rows linked before this migration have NULL and show as "address not stored" until the owner links the address again.
--   * The column lives on the link row, so unlinking, a move to another account, and account deletion remove it
--     together with the row (the existing DELETE FROM email_links statements).

BEGIN;

ALTER TABLE email_links ADD COLUMN IF NOT EXISTS email_enc text CHECK (email_enc IS NULL OR email_enc LIKE 'v1:%');

COMMIT;
