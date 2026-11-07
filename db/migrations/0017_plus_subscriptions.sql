-- Plus sold through Stripe (spec sections 11.2 and 12.1). A Plus subscription is mirrored in the same
-- subscriptions table as Pro and Business. It never changes a license: the user plan reads it directly.

BEGIN;

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_tier_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_tier_check CHECK (tier IN ('pro', 'business', 'plus'));

COMMIT;
