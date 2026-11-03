-- Verified accounts (spec section 8, issues #28 and #51).

BEGIN;

-- The claim uri an attestation was issued for. Delivery only counts an attestation while the
-- indexed claim still has this uri, so rewriting a claim record voids its attestation.
ALTER TABLE attestations ADD COLUMN claim_uri text;

-- Latest attestation per claim, for delivery and the claims dashboard.
CREATE INDEX attestations_claim_created_idx ON attestations (claim_did, claim_rkey, created_at DESC);

-- Mastodon OAuth apps, registered once per instance with POST /api/v1/apps.
CREATE TABLE mastodon_apps (
  instance       text PRIMARY KEY,
  client_id      text NOT NULL,
  client_secret  text NOT NULL,
  redirect_uri   text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Pending OAuth verifications (GitHub and Mastodon), keyed by the state value.
-- Rows are deleted when used and ignored after 15 minutes.
CREATE TABLE verification_state (
  state       text PRIMARY KEY,
  did         text NOT NULL,
  rkey        text NOT NULL,
  provider    text NOT NULL CHECK (provider IN ('github', 'mastodon')),
  instance    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_state_created_idx ON verification_state (created_at);

COMMIT;
