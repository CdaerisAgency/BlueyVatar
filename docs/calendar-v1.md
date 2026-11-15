# Avatar calendar (v1)

Issue #219. Page: `/account/avatars/schedule` ("Avatar calendar" under Profile in the account menu). Plus plan. Out-of-office stays free.

## How it works
- **Settings live in our database** (table `avatar_schedule`, migration 0044), one row per account: the schedule, the time zone, when the next change is due, and the bookkeeping the switch needs. They are not in the lexicon, so they are private and not portable.
- **Entries** are specific dates and weekly days, each naming one of the user's original images by record key. A date entry beats a weekly entry. The `holiday` hook in `packages/core/src/schedule.ts` is unused (holidays are #220). Renders made by the effects feature cannot be scheduled.
- **A time zone is required** before any entry can be saved. The page prefills the browser's zone (or the profile's). A day starts at midnight in that zone. The date logic is `packages/core/src/schedule.ts`.
- **One look per profile.** The calendar changes which image is the default. It does not store a look of its own.

## The switch
`apps/indexer/src/schedule-switch.ts` runs every minute, finds rows whose `next_change_at` has passed, and POSTs `{ did }` to `/account/avatars/schedule/tick` with `Authorization: Bearer $EFFECTS_TICK_SECRET` (the same secret as the out-of-office job; no new secret). The web app does the step because only it holds the OAuth keys that write to a repository. The step claims the row with a short lease, re-checks that it is due, and:
- **An entry applies:** the scheduled image becomes the default (`setDefaultImage`, then the same push as any default change). The default from before the calendar took over is remembered once.
- **No entry applies** (or Plus has lapsed): the remembered default comes back. If the user chose another default meanwhile, that choice stands.
- **Out-of-office is on:** the calendar waits and looks again two minutes after it ends.
- **A frame or filter look is saved and in force:** the scheduled image goes through the effects flow (`applyFrame`, scheduled image as the source), so the look stays applied. Restoring does the same from the original that was the source before.
- **A failure** is shown on the page and retried in 15 minutes.

`next_change_at` is set to now on every save (so the first change happens within a minute) and afterwards to the next local midnight at which the image changes (`nextChange`).

## Deleting an image
Deleting an image on the Avatars page removes it from the date and weekly entries (`stripImage`). If it was the image in force, the next tick restores the user's default.

## Data export and deletion
The table is in the account export (`avatarCalendar`) and is deleted with the account. The Danger zone page lists it.

## Known gaps
- Needs `EFFECTS_TICK_SECRET` on the web app and the indexer, like out-of-office. Until then the route answers 404 and the job logs that it is off.
- A page for axe and 390 px checks (`apps/web/a11y/axe.mjs`) is not added yet.
- Holidays (#220) plug into the `holiday` option later.
