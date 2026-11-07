-- Organization accounts for Business licenses (issue #180, spec section 10.3).
-- An organization is a service-side record. Members are atproto DIDs; there are no email invites, so no invitee address is stored.
-- An organization license has licenses.org_id set and licenses.owner = the billing owner DID, who holds the Stripe customer.

BEGIN;

CREATE TABLE organizations (
  org_id      text PRIMARY KEY,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  org_id    text NOT NULL REFERENCES organizations (org_id) ON DELETE CASCADE,
  did       text NOT NULL,
  role      text NOT NULL CHECK (role IN ('owner', 'member')),
  -- NULL once the adding account deletes its data.
  added_by  text,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, did)
);
CREATE INDEX organization_members_did_idx ON organization_members (did);

ALTER TABLE licenses ADD COLUMN org_id text REFERENCES organizations (org_id) ON DELETE CASCADE;
-- One license per organization.
CREATE UNIQUE INDEX licenses_org_idx ON licenses (org_id) WHERE org_id IS NOT NULL;

-- Membership and key changes inside an organization. Rows are only ever inserted.
-- actor and target_did become NULL when that account deletes its data (issue #140 and #166), so the row survives without the DID.
CREATE TABLE organization_audit (
  id          bigserial PRIMARY KEY,
  org_id      text NOT NULL REFERENCES organizations (org_id) ON DELETE CASCADE,
  actor       text,
  action      text NOT NULL CHECK (action IN
                ('org_created', 'member_added', 'member_removed', 'member_left', 'role_changed',
                 'key_created', 'key_rotated', 'key_revoked', 'key_domains_changed')),
  target_did  text,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_audit_org_idx ON organization_audit (org_id, created_at DESC);

COMMIT;
