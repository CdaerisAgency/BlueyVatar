-- Upload screening events and atproto label enforcement (issue #207).

BEGIN;

-- Labels from configured labelers, on a DID or an at:// record URI. Only values blueyvatar enforces are stored.
-- A negation (neg) deletes the row. src is the labeler DID. cid is kept for audit; matching ignores it.
CREATE TABLE moderation_labels (
  src         text NOT NULL,
  subject     text NOT NULL,
  subject_did text NOT NULL,
  cid         text,
  val         text NOT NULL,
  cts         timestamptz NOT NULL,
  exp         timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (src, subject, val)
);
CREATE INDEX moderation_labels_did_idx ON moderation_labels (subject_did);

-- Where each labeler subscription resumes (the last seq processed).
CREATE TABLE label_cursors (
  src        text PRIMARY KEY,
  cursor     bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Restricted: upload screening outcomes. No image data and no hashes, only the flag that a match or an
-- outage happened, the account, and the time. Not read by any public page. The daily digest reads counts.
CREATE TABLE upload_scan_events (
  id         bigserial PRIMARY KEY,
  did        text NOT NULL,
  service    text NOT NULL,
  outcome    text NOT NULL CHECK (outcome IN ('match', 'outage_blocked', 'outage_allowed')),
  flags      text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX upload_scan_events_created_idx ON upload_scan_events (created_at);
CREATE INDEX upload_scan_events_did_idx ON upload_scan_events (did, created_at DESC);

-- Review-queue items created from labels. label_key (labeler|subject|value) keeps one open item per label.
ALTER TABLE reports ADD COLUMN origin text NOT NULL DEFAULT 'user' CHECK (origin IN ('user', 'label'));
ALTER TABLE reports ADD COLUMN label_key text;
CREATE UNIQUE INDEX reports_label_open_idx ON reports (label_key) WHERE status = 'open' AND label_key IS NOT NULL;

COMMIT;
