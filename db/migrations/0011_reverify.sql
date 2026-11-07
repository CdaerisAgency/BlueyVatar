-- Scheduled re-verification of attested claims (spec section 8, issue #51).

BEGIN;

-- verified_at: when the claim last passed verification (the attestation was written, or a
--   re-check succeeded). The re-verification job picks rows where this is older than the cutoff.
-- last_checked_at: when the job last tried the claim, whatever the outcome.
-- fail_count: consecutive failed re-checks. Reset to 0 on success. Three revoke the attestation.
ALTER TABLE attestations
  ADD COLUMN verified_at      timestamptz,
  ADD COLUMN last_checked_at  timestamptz,
  ADD COLUMN fail_count       integer NOT NULL DEFAULT 0;

UPDATE attestations SET verified_at = created_at;
ALTER TABLE attestations ALTER COLUMN verified_at SET DEFAULT now();

CREATE INDEX attestations_reverify_idx ON attestations (verified_at) WHERE result = 'verified';

COMMIT;
