-- Holiday avatars (issue #220): the holiday settings sit beside the calendar entries in the same row.
--
-- holidays: { country: 'US' | '', region: 'CA' | '', picks: [{ id, image, daysBefore, daysAfter }] }
--   country is an ISO 3166-1 alpha-2 code and region a subdivision code, both as the date-holidays library lists them.
--   A pick names a holiday by the id apps/web derives from the library's English name, and one of the account's original
--   images by record key. daysBefore and daysAfter are 0 to 14. Validated by parseHolidaySettings in packages/core on
--   every read and write. Only holidays with a pick are active. The default image is the account's own default.

BEGIN;

ALTER TABLE avatar_schedule
  ADD COLUMN holidays jsonb NOT NULL DEFAULT '{"country":"","region":"","picks":[]}'::jsonb;

COMMIT;
