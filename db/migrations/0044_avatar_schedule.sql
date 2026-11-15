-- Avatar calendar (issue #219): one row per account holding which of its original images shows on which day.
-- Settings live here (service database, not the lexicon). The switch happens by changing the user's default image
-- through the web app, which the indexer job asks to do when next_change_at has passed.
--
-- schedule: { dates: [{ date: 'YYYY-MM-DD', image: <image rkey> }], weekly: [{ weekday: 0-6, image: <image rkey> }] }
--   (weekday 0 is Sunday). Validated by parseSchedule in packages/core on every read and write.
-- timezone: IANA zone that decides when a day starts. Required before a schedule is saved.
-- next_change_at: when the indexer job should next ask the web app to look at this account. Null means nothing is due.
--   A failed switch sets it 15 minutes ahead; a calendar waiting for out-of-office sets it to when that ends.
-- state: idle (no scheduled image applied), applied (applied_image is the default), failed (last_error says why).
-- applied_image: the scheduled image (an original) in force. applied_default: the image that became the default for it
--   (the same record, or its render when a frame or filter look is saved).
-- prev_default / prev_look_source: what to bring back when no entry applies any more.

BEGIN;

CREATE TABLE avatar_schedule (
  did                text PRIMARY KEY,
  schedule           jsonb NOT NULL DEFAULT '{"dates":[],"weekly":[]}'::jsonb,
  timezone           text NOT NULL,
  next_change_at     timestamptz,
  state              text NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'applied', 'failed')),
  applied_image      text,
  applied_default    text,
  prev_default       text,
  prev_look_source   text,
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- The indexer job scans for rows whose next change has passed.
CREATE INDEX avatar_schedule_due_idx ON avatar_schedule (next_change_at) WHERE next_change_at IS NOT NULL;

COMMIT;
