-- Moderation review portal (issue #209, spec section 9). Needs 0012, 0021, 0028, and 0030.
-- Cases group reports, scanner results, label hits, and appeals about one image (CID) or one account (DID), so a
-- reviewer sees one job instead of many. The audit log gains the policy cited, the case, and the notice sent.

BEGIN;

-- One row per job. Open cases (status <> 'resolved') are unique per dedupe_key: 'cid:<cid>' when the image is known,
-- otherwise 'did:<did>'. Appeals always get their own case ('appeal:<id>').
-- child_safety: the case is in the restricted queue. The portal never shows its image, only metadata.
CREATE TABLE review_cases (
  id               bigserial PRIMARY KEY,
  dedupe_key       text NOT NULL,
  subject_did      text NOT NULL,
  subject_cid      text,
  status           text NOT NULL DEFAULT 'unreviewed' CHECK (status IN ('unreviewed', 'escalated', 'appeal', 'resolved')),
  severity         text NOT NULL CHECK (severity IN ('critical', 'high', 'moderate', 'low')),
  child_safety     boolean NOT NULL DEFAULT false,
  diverted_at      timestamptz,
  tags             text[] NOT NULL DEFAULT '{}',
  opened_at        timestamptz NOT NULL DEFAULT now(),
  first_action_at  timestamptz,
  resolved_at      timestamptz,
  resolved_by      text,
  locked_by        text,
  locked_until     timestamptz
);
CREATE UNIQUE INDEX review_cases_open_key ON review_cases (dedupe_key) WHERE status <> 'resolved';
CREATE INDEX review_cases_queue_idx ON review_cases (status, child_safety, opened_at);
CREATE INDEX review_cases_did_idx ON review_cases (subject_did);
CREATE INDEX review_cases_cid_idx ON review_cases (subject_cid) WHERE subject_cid IS NOT NULL;

-- Why a case exists. kind 'report' rows point at reports (the reporter's contact and IP hash are never read),
-- 'scanner' rows point at upload_scan_events matches and 'label' rows come from label-origin reports (migration 0030), 'appeal' rows point at appeals, and 'manual' rows are cases a reviewer opened by hand.
-- source: the scanner service or label value (for example 'photodna' or 'porn'); null for reports and appeals.
CREATE TABLE case_signals (
  id          bigserial PRIMARY KEY,
  case_id     bigint NOT NULL REFERENCES review_cases (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('report', 'scanner', 'label', 'appeal', 'manual')),
  category    text NOT NULL,
  source      text,
  report_id   bigint UNIQUE,
  appeal_id   bigint UNIQUE,
  scan_event_id bigint UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_signals_case_idx ON case_signals (case_id);

-- A reviewer who skips a case does not get it served again for a while.
CREATE TABLE case_skips (
  case_id    bigint NOT NULL REFERENCES review_cases (id) ON DELETE CASCADE,
  actor      text NOT NULL,
  skipped_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, actor)
);

-- Per-reviewer wellness settings. Defaults (blur 16 px, grayscale on) apply to anyone without a row.
CREATE TABLE reviewer_prefs (
  did        text PRIMARY KEY,
  blur_px    integer NOT NULL DEFAULT 16 CHECK (blur_px BETWEEN 0 AND 40),
  grayscale  boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A rating change made by a reviewer. While active it wins over the rating in the user's record, so a re-index does not undo it.
CREATE TABLE rating_overrides (
  did          text NOT NULL,
  cid          text NOT NULL,
  rating       text NOT NULL CHECK (rating IN ('g', 'pg', 'r', 'x')),
  prior_rating text NOT NULL CHECK (prior_rating IN ('g', 'pg', 'r', 'x')),
  set_by       text NOT NULL,
  set_at       timestamptz NOT NULL DEFAULT now(),
  lifted_at    timestamptz,
  PRIMARY KEY (did, cid)
);

-- One row per day the digest job ran, so a restart or a second instance does not send it twice.
CREATE TABLE moderation_digest_runs (
  run_day  date PRIMARY KEY,
  ran_at   timestamptz NOT NULL DEFAULT now(),
  sent     boolean NOT NULL DEFAULT false
);

-- Audit log additions: the case, the policy cited, and (on 'notice_sent' rows) the notice template name and result, never the text.
ALTER TABLE admin_actions ADD COLUMN IF NOT EXISTS case_id bigint;
ALTER TABLE admin_actions ADD COLUMN IF NOT EXISTS policy text;
ALTER TABLE admin_actions ADD COLUMN IF NOT EXISTS notice_template text;
ALTER TABLE admin_actions ADD COLUMN IF NOT EXISTS notice_result text;
-- detail: the values behind the action (tag, rating before and after, duration, what was reversed). Never an address or image.
ALTER TABLE admin_actions ADD COLUMN IF NOT EXISTS detail jsonb;
CREATE INDEX IF NOT EXISTS admin_actions_case_idx ON admin_actions (case_id) WHERE case_id IS NOT NULL;

ALTER TABLE admin_actions DROP CONSTRAINT IF EXISTS admin_actions_action_check;
ALTER TABLE admin_actions ADD CONSTRAINT admin_actions_action_check CHECK (action IN
  ('block_image', 'unblock_image', 'takedown', 'suspend', 'unsuspend', 'dismiss_report', 'appeal_upheld', 'appeal_overturned',
   'acknowledge', 'rating_change', 'warn', 'escalate', 'reverse', 'comment', 'tag', 'reveal_image', 'divert', 'notice_sent'));

-- The log is append-only: rows can be inserted, never changed or deleted.
CREATE OR REPLACE FUNCTION admin_actions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_actions is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS admin_actions_no_change ON admin_actions;
CREATE TRIGGER admin_actions_no_change BEFORE UPDATE OR DELETE ON admin_actions
  FOR EACH ROW EXECUTE FUNCTION admin_actions_immutable();

-- Reports can now be about child safety, which goes to the restricted queue.
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reason_check;
ALTER TABLE reports ADD CONSTRAINT reports_reason_check CHECK (reason IN
  ('illegal', 'copyright', 'explicit', 'impersonation', 'harassment', 'private_info', 'spam', 'other', 'child_safety'));

COMMIT;
