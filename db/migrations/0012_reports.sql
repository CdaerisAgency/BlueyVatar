-- Abuse reports and operator takedown records (spec section 9, issue #92).

BEGIN;

-- reporter_contact: optional address the reporter chose to give. Never logged and never shown on a public page.
-- ip_hash: SHA256 of a server secret plus the client IP. It drives the per-IP rate limit and is not reversible.
-- actioned_*: set when an operator blocks the target's images, so the block has an owner and a reason.
CREATE TABLE reports (
  id               bigserial PRIMARY KEY,
  target_did       text NOT NULL,
  source           text NOT NULL CHECK (source IN ('profile', 'avatar')),
  reason           text NOT NULL CHECK (reason IN ('illegal', 'copyright', 'explicit', 'impersonation', 'harassment', 'private_info', 'spam', 'other')),
  details          text,
  reporter_contact text,
  ip_hash          text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  actioned_by      text,
  action_reason    text,
  actioned_at      timestamptz
);
CREATE INDEX reports_target_idx ON reports (target_did, created_at DESC);
CREATE INDEX reports_ip_idx ON reports (ip_hash, created_at);
CREATE INDEX reports_open_idx ON reports (created_at) WHERE status = 'open';

COMMIT;
