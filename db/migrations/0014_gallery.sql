-- Gallery images (issue #30). Gallery images are com.blueyvatar.image records with
-- purpose = 'gallery'. A record without the field is an avatar, so existing rows stay valid.
ALTER TABLE images
  ADD COLUMN purpose text NOT NULL DEFAULT 'avatar',
  ADD COLUMN caption text,
  ADD COLUMN sort    integer;
CREATE INDEX images_gallery_idx ON images (did, sort, created_at) WHERE purpose = 'gallery';
