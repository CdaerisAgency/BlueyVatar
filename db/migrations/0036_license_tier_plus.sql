-- Store the Plus plan as 'plus' in licenses.tier.
--
-- Plus and Pro were combined into one Plus plan (PR 261). The check constraint from 0001 allows 'pro' and not 'plus',
-- so that change stored Plus licenses as 'pro' and read them back as Plus. This migration finishes the job:
--   1. Replace the check constraint so it allows free, plus, business, enterprise, and still 'pro'. 'pro' stays allowed
--      during the transition so a rolling deploy (old web instances still writing 'pro') cannot violate it. A later
--      migration can drop 'pro' once no instance writes it.
--   2. Rename existing 'pro' licenses to 'plus'.
-- Other tables: subscriptions.tier already allows 'plus' (0017) and keeps 'pro' for old mirrored rows, so it is not
-- changed. No other table, trigger, or constraint lists license tier values. API keys and subscriptions reference a
-- license by license_id, so renaming the tier changes no key and no subscription.
-- Safe to run twice: the constraint is dropped if present before it is added, and the UPDATE matches nothing the
-- second time. The migration runner supplies the transaction, so BEGIN and COMMIT are written out for manual runs only.

BEGIN;

ALTER TABLE licenses DROP CONSTRAINT IF EXISTS licenses_tier_check;
ALTER TABLE licenses ADD CONSTRAINT licenses_tier_check
  CHECK (tier IN ('free', 'plus', 'pro', 'business', 'enterprise'));

UPDATE licenses SET tier = 'plus' WHERE tier = 'pro';

COMMIT;
