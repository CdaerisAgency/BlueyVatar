-- blueyvatar initial schema (spec sections 5, 6, 10, 12).
-- The service never stores a raw email address or a raw API key.

BEGIN;

-- Repos the indexer tracks, with their latest identity and account status.
CREATE TABLE repos (
  did         text PRIMARY KEY,
  handle      text,
  active      boolean NOT NULL DEFAULT true,
  -- Tap account status when inactive: takendown, suspended, deactivated, deleted.
  status      text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX repos_handle_idx ON repos (lower(handle));

-- SHA256 of the trimmed, lowercased email mapped to a DID (spec section 6).
CREATE TABLE email_links (
  email_hash   char(64) PRIMARY KEY CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  did          text NOT NULL,
  verified_at  timestamptz NOT NULL DEFAULT now(),
  -- trusted_pds: confirmed email from a trusted PDS host; code: one-time code.
  method       text NOT NULL CHECK (method IN ('trusted_pds', 'code'))
);
CREATE INDEX email_links_did_idx ON email_links (did);

-- Indexed com.blueyvatar.image records.
CREATE TABLE images (
  did         text NOT NULL,
  rkey        text NOT NULL,
  cid         text NOT NULL,
  mime_type   text NOT NULL,
  rating      text NOT NULL CHECK (rating IN ('g', 'pg', 'r', 'x')),
  is_default  boolean NOT NULL DEFAULT false,
  license     text,
  created_at  timestamptz NOT NULL,
  indexed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (did, rkey)
);

-- Indexed com.blueyvatar.profile records (rkey is always "self").
CREATE TABLE profiles (
  did         text PRIMARY KEY,
  record      jsonb NOT NULL,
  indexed_at  timestamptz NOT NULL DEFAULT now()
);

-- Indexed com.blueyvatar.claim records.
CREATE TABLE claims (
  did         text NOT NULL,
  rkey        text NOT NULL,
  platform    text,
  uri         text,
  record      jsonb NOT NULL,
  indexed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (did, rkey)
);

-- com.blueyvatar.attestation records the service writes to its own repo.
CREATE TABLE attestations (
  uri          text PRIMARY KEY,
  cid          text NOT NULL,
  claim_did    text NOT NULL,
  claim_rkey   text NOT NULL,
  claim_cid    text NOT NULL,
  result       text NOT NULL CHECK (result IN ('verified', 'failed', 'revoked')),
  method       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attestations_claim_idx ON attestations (claim_did, claim_rkey);

-- Per-user visibility rules (spec section 10.2). A missing row means public.
CREATE TABLE visibility_rules (
  did                   text PRIMARY KEY,
  keyed_only            boolean NOT NULL DEFAULT false,
  domain_allowlist      text[] NOT NULL DEFAULT '{}',
  hidden_profile        boolean NOT NULL DEFAULT false,
  email_lookup_opt_out  boolean NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Images removed from delivery after a report, keyed by blob CID.
CREATE TABLE blocked_images (
  did         text NOT NULL,
  cid         text NOT NULL,
  reason      text,
  blocked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (did, cid)
);

-- Developer licenses (spec section 10.3).
CREATE TABLE licenses (
  license_id            text PRIMARY KEY,
  owner                 text NOT NULL,
  tier                  text NOT NULL CHECK (tier IN ('free', 'pro', 'business', 'enterprise')),
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'past_due', 'suspended', 'canceled')),
  term                  text NOT NULL DEFAULT 'monthly' CHECK (term IN ('monthly', 'annual')),
  attribution_required  boolean NOT NULL DEFAULT true,
  -- Limits and feature flags copied from the tier at issue time.
  entitlements          jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX licenses_owner_idx ON licenses (owner);

-- API keys. Only a SHA256 of the full key is stored, plus a short prefix for display.
CREATE TABLE api_keys (
  key_hash    char(64) PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  prefix      text NOT NULL,
  license_id  text NOT NULL REFERENCES licenses (license_id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('secret', 'publishable')),
  label       text,
  -- Exact hosts, *.example.com wildcards, or localhost. Publishable keys only.
  domains     text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
CREATE INDEX api_keys_license_idx ON api_keys (license_id);

-- Metered usage per license (spec section 12).
CREATE TABLE usage_counters (
  license_id    text NOT NULL REFERENCES licenses (license_id) ON DELETE CASCADE,
  meter         text NOT NULL CHECK (meter IN ('origin_resolution', 'transform', 'profile_json', 'bytes_delivered')),
  period_start  date NOT NULL,
  count         bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (license_id, meter, period_start)
);

-- Fixed-window rate limits keyed by license or client IP.
CREATE TABLE rate_windows (
  bucket      text PRIMARY KEY,
  count       integer NOT NULL DEFAULT 0,
  reset_at    timestamptz NOT NULL
);
CREATE INDEX rate_windows_reset_idx ON rate_windows (reset_at);

COMMIT;
