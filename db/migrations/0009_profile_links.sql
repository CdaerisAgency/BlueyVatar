-- Link records from app.bsky.actor.link, indexed so the profile API can resolve the
-- strongRefs in app.bsky.actor.profile#links (issue #29, spec sections 3 and 8).
-- cid is the record CID: a ref whose cid no longer matches points at an edited record and is dropped.

BEGIN;

CREATE TABLE IF NOT EXISTS profile_links (
  did        text        NOT NULL,
  rkey       text        NOT NULL,
  cid        text        NOT NULL,
  url        text        NOT NULL,
  title      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  indexed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (did, rkey)
);

COMMIT;
