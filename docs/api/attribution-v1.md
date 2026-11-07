# Free-tier attribution (v1)

Source: spec sections 10.3, 11.1, and 12. Code: `packages/core/src/verification/attribution.ts` (detector), `apps/indexer/src/attribution.ts` (checker), migration `db/migrations/0024_attribution.sql`.

The Free developer tier asks for an attribution link to blueyvatar.com on the developer's production site. Pro, Business, and Enterprise do not need it (`attributionRequired` in `packages/core/src/tiers.ts`).

## The snippet

```html
<a href="https://blueyvatar.com">Avatars by blueyvatar</a>
```

The link has no query string and no tracking. The exact wording of the visible text is a placeholder until the owner approves the final copy. The `/account/keys` page shows the snippet for licenses that require attribution.

## What counts

A link counts when all of these hold:

- Public: an `<a>` element in the page HTML that visitors can see without signing in. `<link>` elements and commented-out or scripted markup do not count.
- Followable: the `rel` list does not contain `nofollow`, `ugc`, or `sponsored`.
- Points at `blueyvatar.com` or `www.blueyvatar.com`, over http or https, with any path. Look-alike hosts and subdomains such as `img.blueyvatar.com` do not count.
- On the production site the developer declares for the key (a public https address).

## Declaring the site

On `/account/keys`, each publishable key on a license that requires attribution has an optional production site field. It is stored as `api_keys.attribution_site`. Only public https addresses are accepted (no credentials, no port, no private or local hosts). Rotating a key keeps the declared site. Clearing the field stops the check for that key.

## The check

The indexer runs the check every `ATTRIBUTION_INTERVAL_HOURS` (default 24). For each declared site on an active Free license it fetches the page with `safeFetch` (public https only, every hop address-checked, 2 MB and 8 second caps) and stores the outcome in `attribution_result` with the time in `attribution_checked_at`.

| Result | Meaning |
| --- | --- |
| `found` | A public, followable link to blueyvatar.com is on the page |
| `nofollow` | A link exists but every one carries `nofollow`, `ugc`, or `sponsored` |
| `missing` | No link to blueyvatar.com in the page HTML |
| `unreachable` | The fetch failed or the page did not answer 2xx. Inconclusive: no email, tried again next pass |

The page is read as served. A link added only by client-side JavaScript is not seen.

## Notices and enforcement

When a check ends in `nofollow` or `missing`, the owner gets one email (a billing-category notice, so it follows the owner's notification settings). It is sent once per failure streak (`attribution_notified_at`) and re-armed when the link is found again.

This version reports only. A failed check never revokes a key and never changes the license. Whether repeated failures should downgrade or suspend the Free license is an owner decision recorded on issue #182.
