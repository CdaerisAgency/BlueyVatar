-- Stripe billing (issue #67, spec section 12).

-- Grace period end for a past-due license. Past this instant the license reads as Free limits
-- (core effectiveTier), so expiry needs no webhook. NULL unless the license is past due.
ALTER TABLE licenses ADD COLUMN grace_ends_at timestamptz;

-- One Stripe customer per DID. The license is the one the DID owns when the customer was created.
CREATE TABLE billing_customers (
  did                text PRIMARY KEY,
  license_id         text NOT NULL REFERENCES licenses (license_id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Mirror of each Stripe subscription. The license tier is derived from these rows.
CREATE TABLE subscriptions (
  stripe_subscription_id text PRIMARY KEY,
  stripe_customer_id     text NOT NULL,
  did                    text NOT NULL,
  license_id             text NOT NULL REFERENCES licenses (license_id) ON DELETE CASCADE,
  price_id               text NOT NULL,
  tier                   text NOT NULL CHECK (tier IN ('pro', 'business')),
  status                 text NOT NULL CHECK (status IN
                           ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  -- When the subscription first went past due. Starts the grace period; cleared on recovery.
  past_due_since         timestamptz,
  -- created time of the newest Stripe event applied, so a late older event cannot overwrite newer state.
  last_event_at          timestamptz NOT NULL,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_license_idx ON subscriptions (license_id);
CREATE INDEX subscriptions_customer_idx ON subscriptions (stripe_customer_id);

-- Processed Stripe event ids, for idempotent webhooks. Inserted in the same transaction as the event's effects.
CREATE TABLE stripe_events (
  event_id     text PRIMARY KEY,
  type         text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
