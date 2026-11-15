-- Avatar effects slice 2 (issue #218): an image filter next to the frame in the one look per profile.
-- filter_id: one of the ids in lib/effects/catalog.ts (mono, sepia, warm, cool, contrast), or null for no filter.
-- A look may now be a filter alone, so frame_style and frame_color may both be null while frame_image_rkey is set.

BEGIN;

ALTER TABLE avatar_effects ADD COLUMN filter_id text;

COMMIT;
