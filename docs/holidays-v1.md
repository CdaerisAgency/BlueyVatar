# Holiday avatars (v1)

Issue #220. Page: `/account/avatars/holidays` ("Holiday avatars", linked from the avatar calendar page). Plus plan, like the calendar. Built on the calendar in `docs/calendar-v1.md`.

## How it works
- **One country, optional region.** The user picks a country (and a state or province where the library lists any). Changing the country removes the picks; changing the region keeps them.
- **Only picked holidays are active.** For each holiday the user chooses one original image and how many days before and after it shows (0 to 14 each). A holiday spans its own days (a few are longer than one day) plus those margins.
- **A default avatar must exist** before a pick saves. It is the avatar shown on every day no holiday, date entry, or weekly entry applies (the calendar restores the user's own default).
- **Settings live in our database**, in the calendar row: column `holidays` on `avatar_schedule` (migration 0045): `{ country, region, picks: [{ id, image, daysBefore, daysAfter }] }`. Validated by `parseHolidaySettings` (`packages/core/src/holidays.ts`) on every read and write. Private, in the account export (`avatarCalendar.holidays`), deleted with the account, and listed on the Danger zone page. Deleting an image removes it from the picks.
- **The calendar applies them.** `packages/core/src/schedule.ts` already took an optional `holiday` hook. `holidayLookup` fills it, so the precedence is date entry, then holiday, then weekly entry, and `tickSchedule` and `nextChange` need nothing else.
- **Time zone.** A holiday is a calendar date. The owner's zone (from the calendar settings) decides when that date starts, never the country's zone. The library's own zone is ignored; only the printed date is read.

## Which holidays are listed
`date-holidays` types each holiday. Types `public` and `bank` are listed by default. `observance` and `optional` days (Halloween, Mother's Day, Christmas Eve) are labelled "popular" and shown when the user ticks "Also show popular days". School days are never listed. A "substitute day" (a day off moved to a weekday) is not listed: the holiday's own date is used. The id of a holiday is its English name in lowercase with hyphens (`thanksgiving-day`), so a rename in a later library version turns a pick into "no longer on the country list" (the page offers Remove). Lunar and religious dates are whatever the library computes; they can differ by a day from local announcements.

## Overlap rules
When more than one pick applies on a local date: a holiday whose own span contains the date wins, then the closest span, then an upcoming holiday over one just past, then the pick that comes first in the list. Occurrences are read for the year before, the year of, and the year after, so a window can cross New Year. Code: `resolveHoliday`.

## Data source, license and attribution
Holiday data comes from the [`date-holidays`](https://github.com/commenthol/date-holidays) npm package, pinned to exactly 3.39.2 in `apps/web/package.json`. npm lists its license as `(ISC AND CC-BY-SA-4.0)`. From its LICENSE file (read at that version):

- The data in `holidays.yaml` "is available under CC BY-SA 4.0 ... as the data obtained relies on wikipedia articles. The required attribution can be found inside the file."
- All other code is Copyright (c) 2015 commenthol under ISC. The ISC notice must stay with copies of the code, which it does as the package ships its LICENSE.
- The LICENSE ends with a "CC BY-SA 3.0 Attributions" list of the Wikipedia pages used, and the README says the data in `holidays.json` and `data/countries/*.yaml` is CC BY-SA 3.0. The package therefore states 4.0 in LICENSE and package metadata and 3.0 in its README. We follow the LICENSE and the npm metadata (4.0), credit the source, and link both the LICENSE and the license text. Owner: if you want this settled, ask the library's author which version applies.

What we do about it:
- A visible credit and license line on the holidays page (`HolidayCredit.tsx`): library, author, ISC code, CC BY-SA 4.0 data, Wikipedia basis, and links to the library, its LICENSE (which carries the attribution list) and the license text.
- We show the data unchanged and do not copy it into the repository, so no derivative data exists today. Any holiday data we change or add stays under the same CC BY-SA license, with a note in this file and an attribution next to it.
- Upgrading the library: bump the exact version, read its LICENSE again, and update this section and the credit line if the terms moved.

## Known gaps
- Region lists use the library's codes and English names.
- Holidays with no English name in the library show in the country's own language, and their id follows that name.
- No axe or 390 px page check yet, like the calendar page.
