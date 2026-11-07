-- Operator-driven image blocks (issue #48). The blocked_images table already exists (0001_init.sql)
-- and delivery's isBlocked() reads it, so this adds the audit columns and a way to lift a block.
-- The (did, cid) primary key already provides the lookup index. A block is active while
-- unblocked_at is null; blocking again clears unblocked_at and refreshes the other columns.

BEGIN;

ALTER TABLE blocked_images ADD COLUMN IF NOT EXISTS blocked_by text;
ALTER TABLE blocked_images ADD COLUMN IF NOT EXISTS unblocked_at timestamptz;

COMMIT;
