-- Per-day usage for the usage API and dashboard (spec section 11.1, "Usage dashboard and API").
-- The monthly counters in usage_counters stay the source for billing and alerts. These rows
-- only add day granularity for origin_resolution and profile_json.
CREATE TABLE usage_daily (
  license_id  text NOT NULL REFERENCES licenses (license_id) ON DELETE CASCADE,
  meter       text NOT NULL CHECK (meter IN ('origin_resolution', 'profile_json')),
  day         date NOT NULL,
  count       bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (license_id, meter, day)
);
