-- Custom profile domains (spec sections 3 row 29 and 11.2, Plus plan).
-- A user serves their profile from one subdomain they own, via Cloudflare for SaaS
-- custom hostnames. The proxy maps a verified hostname to /p/{handle}.

BEGIN;

CREATE TABLE custom_domains (
  did          text PRIMARY KEY,
  -- Lowercase, no trailing dot. Unique across all users.
  hostname     text NOT NULL UNIQUE CHECK (hostname = lower(hostname)),
  -- Cloudflare custom hostname ID, used to poll and delete.
  cf_id        text NOT NULL,
  -- pending: waiting for DNS; active: hostname and certificate both active; failed: Cloudflare reported a blocking state.
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'failed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  verified_at  timestamptz
);

COMMIT;
