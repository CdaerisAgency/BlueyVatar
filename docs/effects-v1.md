# Avatar effects (v1)

Part of issues #218 and #283. Slice 1: a profile frame (Plus) and the out-of-office badge (free). Page: `/account/effects`.

## How it works
- **Settings live in our database** (table `avatar_effects`, migration 0041), one row per account. One look per profile for now.
- **Effects are rendered into a new image.** `lib/effects/render.ts` draws the frame or badge with sharp from the stored original (never from an earlier render), producing a square PNG. The result goes through the same steps as an upload: `prepareUpload`, then `screenUpload`, then the same record writes into the user's repository. It counts toward the plan's image limit, copies the source image's alt text and rating labels, and is delivered and pushed like any avatar. Delivery does not apply effects.
- **Frames** are Plus and above. Starter set: plain ring, double ring, dashed ring, in six palette colors (`lib/effects/catalog.ts`). Saving a frame replaces the earlier frame render and makes the new one the default. Removing it brings the original back as the default.
- **Out-of-office** is free. A badge only (a small umbrella disc), no text, no date on the image. The user picks a first and last day (inclusive) and a time zone. At the start the default image is rendered with the badge and becomes the default; at the end, or when the user turns it off early, the previous default comes back and the away image is deleted. A framed default is rebuilt from its original so the frame is drawn once. While it is on, the frame cannot be changed. If the user chose a different default meanwhile, that choice stays.

## The scheduled switch
`apps/indexer/src/effects-switch.ts` runs every minute, finds windows that have started or ended, and POSTs `{ did }` to `/account/effects/tick` on the web app with `Authorization: Bearer $EFFECTS_TICK_SECRET`. The web app does the step because only it holds the OAuth keys that write to a repository. The step re-checks that it is due, so repeats are harmless. A failed switch-on is marked failed and the reason shows on the page. A failed switch-off retries every 15 minutes.

Both apps need the same `EFFECTS_TICK_SECRET` (web and indexer); the indexer also uses `PUBLIC_URL`. Until it is set, the route answers 404 and the job logs that it is off. Setting it is an owner action in Infisical and Fly.

## Room for later work
- **#308 admin-issued free effects:** `canUse(effect, plan, grants)` already takes a `grants` list. The admin feature adds a table of grants and passes the account's active ones; the catalog and renderer do not change. A render made with a granted effect is an ordinary image and keeps working after the offer ends.
- **Per-image looks:** the flow takes the look as an argument, so a per-image look is a row keyed by image instead of account.
- **Other effects and holidays (#219, #220):** add catalog entries and a trigger; the render and switch pieces are shared.

## Known gaps
- Account export and deletion (`lib/account-data.ts`) do not include `avatar_effects` yet.
- The away window is stored in the service database only, so it is private and not portable.
