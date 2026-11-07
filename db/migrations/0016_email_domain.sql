-- Email domain on the link row (issue #128, docs/research/dns-delegation-v2.md).
--
-- The owner approved storing the domain of the registered email, and only the domain, never the full
-- address. It is set at link time (the part after the last "@", lowercased) and lets a later change look up
-- whether a domain has delegated avatars to its own server. Rows linked before this migration stay NULL until
-- their owner verifies the email again. email_codes carries it for the 15 minutes a pending code lives.

BEGIN;

ALTER TABLE email_links ADD COLUMN IF NOT EXISTS email_domain text
  CHECK (email_domain IS NULL OR (length(email_domain) <= 253 AND email_domain !~ '[@[:space:]]'));
ALTER TABLE email_codes ADD COLUMN IF NOT EXISTS email_domain text
  CHECK (email_domain IS NULL OR (length(email_domain) <= 253 AND email_domain !~ '[@[:space:]]'));

COMMIT;
