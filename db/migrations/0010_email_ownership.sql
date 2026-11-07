-- Email ownership rules (spec section 6; issues #63 and #93).
--   * One hash maps to one DID. email_links.email_hash is already the primary key.
--   * Newest verification wins: the store removes the old row and inserts the new one in one transaction.
--   * At most 10 linked emails per account, enforced by the store (under an advisory lock) and by the trigger below.
--   * One primary email per account, shown first on the account page.
--   * A released hash (unlinked, or account deleted) is held for 30 days. The hold is a separate table so
--     delivery lookups against email_links never see released rows and the unique MD5 index stays clean.
--     The same DID may reclaim the hash during the hold; another DID may not until it expires.

BEGIN;

ALTER TABLE email_links ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- Backfill: the first email each account linked becomes its primary.
UPDATE email_links e
   SET is_primary = true
  FROM (SELECT DISTINCT ON (did) email_hash FROM email_links ORDER BY did, verified_at, email_hash) f
 WHERE e.email_hash = f.email_hash
   AND NOT EXISTS (SELECT 1 FROM email_links p WHERE p.did = e.did AND p.is_primary);

CREATE UNIQUE INDEX IF NOT EXISTS email_links_primary_idx ON email_links (did) WHERE is_primary;

-- Cap. Accounts already over 10 are left alone; they just cannot add more.
CREATE OR REPLACE FUNCTION email_links_cap() RETURNS trigger AS $$
BEGIN
  IF (SELECT count(*) FROM email_links WHERE did = NEW.did AND email_hash <> NEW.email_hash) >= 10 THEN
    RAISE EXCEPTION 'email_link_cap: an account can link at most 10 emails' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_links_cap_trg ON email_links;
CREATE TRIGGER email_links_cap_trg
  BEFORE INSERT OR UPDATE OF did ON email_links
  FOR EACH ROW EXECUTE FUNCTION email_links_cap();

-- 30-day hold on released hashes. A hold is active while released_at > now() - 30 days.
CREATE TABLE IF NOT EXISTS email_holds (
  email_hash   char(64) PRIMARY KEY CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  did          text NOT NULL,
  released_at  timestamptz NOT NULL DEFAULT now(),
  reason       text NOT NULL CHECK (reason IN ('unlinked', 'account_deleted'))
);
CREATE INDEX IF NOT EXISTS email_holds_released_idx ON email_holds (released_at);

-- Address to notify if confirming this code moves the hash from another account. Set only in that case,
-- and removed with the row when the code is confirmed, replaced, or expires (about 15 minutes).
ALTER TABLE email_codes ADD COLUMN IF NOT EXISTS notify_to text;

COMMIT;
