-- Verified accounts on more platforms (issue #58, docs/research/verified-accounts-v1.md).
-- Pending OAuth verifications now also name Instagram, Threads, TikTok, YouTube, and Twitch.
-- DNS TXT and Bluesky proofs are checked on request and need no stored state.

BEGIN;

ALTER TABLE verification_state DROP CONSTRAINT verification_state_provider_check;
ALTER TABLE verification_state ADD CONSTRAINT verification_state_provider_check
  CHECK (provider IN ('github', 'mastodon', 'instagram', 'threads', 'tiktok', 'youtube', 'twitch'));

COMMIT;
