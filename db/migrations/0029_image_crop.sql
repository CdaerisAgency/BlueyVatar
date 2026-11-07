-- Crop parameters for full originals (issue #203). The image record keeps the whole picture and an
-- optional `crop` (x, y, size), each an integer in units of 1/10000: x of the width, y of the height,
-- size of the short side. Delivery applies it before resizing. All three are null together, which
-- means the center crop. Existing rows stay valid.
ALTER TABLE images
  ADD COLUMN crop_x    integer,
  ADD COLUMN crop_y    integer,
  ADD COLUMN crop_size integer,
  ADD CONSTRAINT images_crop_all_or_none CHECK ((crop_x IS NULL) = (crop_y IS NULL) AND (crop_x IS NULL) = (crop_size IS NULL)),
  ADD CONSTRAINT images_crop_range CHECK (crop_x BETWEEN 0 AND 10000 AND crop_y BETWEEN 0 AND 10000 AND crop_size BETWEEN 1 AND 10000);
