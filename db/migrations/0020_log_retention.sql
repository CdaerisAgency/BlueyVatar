-- Log retention (issue #146). Request logs and database-held logs are kept 90 days or until a size cap, whichever comes first.

BEGIN;

-- reports.ip_hash is cleared once it is older than the retention window, so it can no longer be NOT NULL.
-- The report itself stays: it is the record of a takedown decision, not a request log.
ALTER TABLE reports ALTER COLUMN ip_hash DROP NOT NULL;

-- Let the purge job find old rows without scanning the tables.
CREATE INDEX reports_ip_age_idx ON reports (created_at) WHERE ip_hash IS NOT NULL;
CREATE INDEX stripe_events_age_idx ON stripe_events (processed_at);

COMMIT;
