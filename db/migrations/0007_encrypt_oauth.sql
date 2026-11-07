-- Encrypt OAuth session and state payloads at rest (AES-256-GCM, app side; see apps/web/lib/token-crypto.ts).
-- The columns become text so they can hold `v1:<iv>:<tag>:<ciphertext>`. Existing jsonb rows convert to
-- their JSON text and are read as legacy plaintext, then re-encrypted on the next write.

BEGIN;

ALTER TABLE oauth_state ALTER COLUMN value TYPE text USING value::text;
ALTER TABLE oauth_session ALTER COLUMN value TYPE text USING value::text;

COMMIT;
