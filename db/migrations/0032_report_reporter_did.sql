-- Reports now require a signed-in reporter (issue #224).

BEGIN;

-- reporter_did: the account that filed the report. Null for reports filed before sign-in was required and for
-- system-created reports. It drives the per-account rate limit and is shown to operators only, never publicly.
ALTER TABLE reports ADD COLUMN reporter_did text;
CREATE INDEX reports_reporter_idx ON reports (reporter_did, created_at) WHERE reporter_did IS NOT NULL;

COMMIT;
