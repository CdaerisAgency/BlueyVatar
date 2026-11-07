-- Self-serve account data deletion (issue #140).
-- Deleting an account removes everything except Stripe billing rows, which are kept for 7 years for tax and accounting.
-- Billing rows must outlive the license they were issued under, so the license foreign keys go away, and each
-- row records when its owner deleted their data. The indexer's retention job deletes rows 7 years after that date.

BEGIN;

ALTER TABLE billing_customers DROP CONSTRAINT IF EXISTS billing_customers_license_id_fkey;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_license_id_fkey;

ALTER TABLE billing_customers ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS billing_customers_deleted_idx ON billing_customers (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS subscriptions_deleted_idx ON subscriptions (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS stripe_events_processed_idx ON stripe_events (processed_at);

COMMIT;
