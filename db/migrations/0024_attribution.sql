-- Free-tier attribution check (issue #182, spec sections 10.3, 11.1, and 12).
--   * attribution_site: the production URL the developer declares for a publishable key (public https).
--   * attribution_checked_at / attribution_result: the last check by the indexer. Report only; nothing is revoked.
--     Result is found, nofollow, missing, or unreachable (a fetch failure or non-2xx answer, which is inconclusive).
--   * attribution_notified_at: set when the failure email went out, so the owner is told once per failure streak.
--     Cleared when the link is found again.

BEGIN;

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS attribution_site         text,
  ADD COLUMN IF NOT EXISTS attribution_checked_at   timestamptz,
  ADD COLUMN IF NOT EXISTS attribution_result       text CHECK (attribution_result IN ('found', 'nofollow', 'missing', 'unreachable')),
  ADD COLUMN IF NOT EXISTS attribution_notified_at  timestamptz;

CREATE INDEX IF NOT EXISTS api_keys_attribution_idx ON api_keys (attribution_checked_at NULLS FIRST)
  WHERE attribution_site IS NOT NULL AND revoked_at IS NULL;

COMMIT;
