# Free effect offers (v1)

Issue #308, part of #218. An admin can make a paid effect free for a window. Admin page: `/admin/effects` (ADMIN_DIDS and a live TOTP admin session, like the other admin pages).

## What an offer is
- **Effect:** one paid effect from `lib/effects/catalog.ts` (the list follows `EFFECT_ACCESS`). A free effect needs no offer.
- **Name:** shown to people on the effects page, in the banner, and in the email.
- **Window:** a first and last day, in UTC, last day included. The offer starts at 00:00 UTC on the first day and ends at 00:00 UTC the day after the last day.
- **Who:** everyone, one plan (free or plus), or listed accounts (DIDs or handles the indexer knows, up to 500).
- **Notify people:** off adds the effect quietly. On sends one email when the offer starts and shows a banner on account pages during the window.

## How it works
- Tables (migration 0043): `effect_offers`, `effect_offer_users` (per account: listed, emailed_at, dismissed_at), and `notification_prefs.offer_notices`.
- `lib/effects/grants.ts` holds the logic. `activeGrants(pool, did, plan)` returns the effect ids for `canUse(effect, plan, grants)`. The catalog and renderer are unchanged.
- **Ending early:** `End now` sets `ended_at`. The offer leaves the effects page and banner at once. An avatar already rendered with the effect is an ordinary image and keeps working, as it does when the window ends on its own.
- **Audit log:** create, change and end each write an `admin_actions` row (`effect_offer_create`, `effect_offer_change`, `effect_offer_end`) with the values in `detail`.
- **Banner:** `components/OfferBanner.tsx` in the account layout. Dismissing it stores `dismissed_at` for that account and offer.
- **Email:** `apps/indexer/src/effect-offers.ts` runs every 5 minutes. It claims each eligible account in `effect_offer_users.emailed_at` before sending, so nobody is emailed twice, and releases the claim if the send fails. It uses the notices system (`effectOfferNotice`, kind `offers`), so the message carries the handle line and the notification settings link. People can turn these emails off on `/account/notifications`. Accounts with no address on file are skipped.
- **Privacy:** `effect_offer_users` rows are in the data export and are deleted with the account.

## Known gaps
- Server-side enforcement: `lib/effects/flow.ts` (`applyFrame`) still checks `canUse(effect, plan)` without grants, so a granted account can open the form but a save is refused until that call passes `activeGrants(...)`. Lane S owns that file.
- The email goes to accounts with a primary notice address only.
