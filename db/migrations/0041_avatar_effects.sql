-- Avatar effects (issues #218 and #283): one row per account holding its one look (a frame) and its
-- out-of-office window. Settings live here; blueyvatar renders each look into a normal image record in the
-- user's repository, so delivery serves it like any upload and never applies effects itself.
--
-- frame_*: the frame style and palette color, the original image it was rendered from, and the image record
--   that holds the render (rkeys in the user's com.blueyvatar.image collection).
-- away_start_on/away_end_on/away_timezone: what the user picked. away_start_at/away_end_at are the instants those
--   dates mean in that zone (end is the start of the day after the last day), so the indexer job compares instants only.
-- away_state: off, scheduled (waiting for the start), active (the away image is the default), failed (the switch-on
--   did not work; away_error says why).
-- away_prev_default_rkey: the default image to bring back when the window ends or the user turns it off early.
-- away_retry_at: when a failed switch-off may be tried again.

BEGIN;

CREATE TABLE avatar_effects (
  did                    text PRIMARY KEY,
  frame_style            text,
  frame_color            text,
  frame_source_rkey      text,
  frame_image_rkey       text,
  away_state             text NOT NULL DEFAULT 'off' CHECK (away_state IN ('off', 'scheduled', 'active', 'failed')),
  away_start_on          date,
  away_end_on            date,
  away_timezone          text,
  away_start_at          timestamptz,
  away_end_at            timestamptz,
  away_image_rkey        text,
  away_prev_default_rkey text,
  away_error             text,
  away_retry_at          timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- The indexer job scans for rows whose start or end has passed.
CREATE INDEX avatar_effects_away_due_idx ON avatar_effects (away_state, away_start_at, away_end_at) WHERE away_state IN ('scheduled', 'active');

COMMIT;
