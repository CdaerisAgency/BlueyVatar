-- Screenshots attached to bug reports (issue #266, owner decision 2026-11-14).
-- GitHub has no API for attaching an image to an issue, so the picture is kept here and the filed issue links to a
-- private admin route. Admins only (ADMIN_DIDS plus a live admin session). Deleted after 90 days by the indexer,
-- and with the reporter's account.

BEGIN;

-- id: random, unguessable, used in the admin link. The route also requires an admin session, so the id is not the only guard.
-- did: the signed-in reporter, for account export and deletion.
-- image: JPEG bytes, re-encoded on the server (metadata stripped), at most 1 MB.
-- issue_number: the GitHub issue that links to it, set after the issue is filed.
CREATE TABLE bug_report_screenshots (
  id text PRIMARY KEY,
  did text NOT NULL,
  image bytea NOT NULL,
  issue_number integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bug_report_screenshots_did_idx ON bug_report_screenshots (did);
CREATE INDEX bug_report_screenshots_created_idx ON bug_report_screenshots (created_at);

COMMIT;
