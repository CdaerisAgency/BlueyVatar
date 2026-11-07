-- Profile view statistics for Plus (issue #173, spec section 11.2).
-- One row per DID per UTC day holding two aggregate counters. No IP address, user agent, or cookie is stored.
-- `views` counts non-bot renders of the profile page (web). `json_calls` counts keyed /profile/{id} calls (delivery).
-- Rows older than the published log retention period are purged by delivery's retention job (docs/deploy.md, "Log retention").

BEGIN;

CREATE TABLE IF NOT EXISTS profile_view_counters (
  did        text   NOT NULL,
  day        date   NOT NULL,
  views      bigint NOT NULL DEFAULT 0,
  json_calls bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (did, day)
);

CREATE INDEX IF NOT EXISTS profile_view_counters_day_idx ON profile_view_counters (day);

COMMIT;
