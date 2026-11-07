-- The Free-tier attribution requirement was dropped (issue #182).
ALTER TABLE licenses DROP COLUMN attribution_required;
UPDATE licenses SET entitlements = entitlements - 'attributionRequired';
