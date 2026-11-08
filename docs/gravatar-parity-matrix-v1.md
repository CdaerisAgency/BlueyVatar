# Gravatar and Libravatar parity matrix (v1)

Research for issue #242. Gravatar and Libravatar rows come from published pages fetched November 8, 2026. blueyvatar rows come from the repository at commit `07ae608` (origin/main). "Unknown" means no published page or repo file I read confirms the answer. Nothing here is a build decision; scope decisions are step 2 of the issue.

Related earlier notes: `docs/research/gravatar-gaps-v1.md` (issue #62), `docs/research/qr-code-design-v1.md`, `docs/research/dns-delegation-v2.md`, `docs/api/gravatar-differences-v1.md`.

## 1. Avatar URL options

| Feature | Gravatar | Libravatar | blueyvatar today |
| --- | --- | --- | --- |
| Hash input | SHA256 of trimmed, lowercased email; MD5 not allowed for the v3 API ([REST docs](https://docs.gravatar.com/rest/api-data/)) | MD5 or SHA256 of lowercased email; OpenID URLs use SHA256 ([API](https://wiki.libravatar.org/api/)) | SHA-256 or MD5 hex hash; raw email rejected (`docs/api/gravatar-differences-v1.md`, `packages/core/src/hash.ts`). Also handle and DID routes (`apps/delivery/src/app.ts`: `/avatar/:hash`, `/u/:id`) |
| Size | `s` or `size`, 1 to 2048, default 80 ([SDK images](https://docs.gravatar.com/sdk/images/)) | `s` or `size`, 1 to 512, default 80 ([API](https://wiki.libravatar.org/api/)) | Same params; cap 512 Free, 1024 Pro, 2048 Business and Enterprise (`packages/core/src/tiers.ts`) |
| Rating | `r` or `rating`: g, pg, r, x; default g ([SDK images](https://docs.gravatar.com/sdk/images/)) | Not supported, ignored ([API](https://wiki.libravatar.org/api/)) | g, pg, r, x mapped from atproto self-labels (`packages/core/src/ratings.ts`) |
| Default image values | `initials`, `color`, `404`, `mp`, `identicon`, `monsterid`, `wavatar`, `retro`, `robohash`, `blank`, or a URL ([SDK images](https://docs.gravatar.com/sdk/images/)) | `404`, `mm`/`mp`, `identicon`, `monsterid`, `wavatar`, `retro`, `robohash`, `pagan`, or trusted URL ([API](https://wiki.libravatar.org/api/)) | `404`, `mp`, `identicon`, `monsterid`, `wavatar`, `retro`, `robohash`, `pagan`, `initials`, `blank`; no `color` (`packages/core/src/params.ts`) |
| Custom default URL | Any URL ([SDK images](https://docs.gravatar.com/sdk/images/)) | Local path or trusted external site; arbitrary redirects blocked ([API](https://wiki.libravatar.org/api/)) | HTTPS only, allowlisted host, Pro key or higher (`docs/api/gravatar-differences-v1.md`) |
| Force default | `f=y` or `forcedefault=y` | `f=y` or `forcedefault=y` | Supported (`packages/core/src/params.ts`) |
| Initials and name | `initials`, `name` params ([SDK images](https://docs.gravatar.com/sdk/images/)) | Not documented ([API](https://wiki.libravatar.org/api/)); Unknown | `name=` on hash lookups; handle initials on `/u/{id}` (`docs/api/gravatar-differences-v1.md`) |
| Robohash set | Not documented; Unknown | `robohash=set1..set3` ([API](https://wiki.libravatar.org/api/)) | None found (no `robohash` set param in `packages/core/src/params.ts`) |
| File extension in path | Optional `.jpg` ([SDK images](https://docs.gravatar.com/sdk/images/)) | Unknown | `.png`, `.jpg`, `.jpeg`, `.webp` stripped (`docs/research/gravatar-gaps-v1.md`) |
| Output format and quality | Unknown | Unknown | `fmt` png, jpeg, webp and `quality`; Free is PNG only (`packages/core/src/tiers.ts`) |
| Fallback chain | Unknown | Checks Gravatar, then `default` ([API](https://wiki.libravatar.org/api/)) | Atproto avatar fallback for a DID (`packages/core/src/resolve.ts`, `apps/delivery/src/resolver.ts`) |

## 2. Profile fields

Gravatar source for all Gravatar cells in this section: [OpenAPI spec](https://api.gravatar.com/v3/openapi), fields marked "(auth)" there are returned only to authenticated requests. Libravatar publishes no profile fields on its [home page](https://libravatar.org/) or [API page](https://wiki.libravatar.org/api/), so those cells read "None published".

| Field | Gravatar | Libravatar | blueyvatar today |
| --- | --- | --- | --- |
| Display name, bio | `display_name`, `description` | None published | From `app.bsky.actor.profile`; shown on `/p/{handle}` (`apps/web/app/p/[handle]/page.tsx`) |
| Links | `links` (label, url), auth | None published | Read from `app.bsky.actor.profile#links` (max 10, https only); shown on the page; no editor on `/account/profile` (`packages/core/src/links.ts`, `apps/web/app/account/profile/page.tsx`) |
| Verified accounts | `verified_accounts`, capped at 4 unauthenticated | None published | Yes: attested claims, hide flag, Free JSON cap of 4 (`apps/delivery/src/app.ts`, `packages/core/src/tiers.ts`). Services supported: Unknown (not enumerated in files read) |
| Wallet and crypto addresses | `payments.crypto_wallets` (label, address) and `payments.links`, auth | None published | None. Spec lists "Later" (`docs/spec/blueyvatar-product-spec-v9.md` line 304) |
| Languages | `languages` (code, name, is_primary, order), auth | None published | None. No field in `lexicons/com/blueyvatar/profile.json` |
| Pronouns | `pronouns` | None published | Yes (`lexicons/com/blueyvatar/profile.json`) |
| Pronunciation | `pronunciation` | None published | Yes |
| Location | `location` | None published | Yes |
| Job title, company | `job_title`, `company` | None published | Yes |
| Time zone | `timezone`, auth | None published | Yes (IANA name) |
| Interests | `interests`, auth | None published | Yes (up to 20) |
| Contact info (phones, email, form, calendar) | `contact_info`, only if user made it public | None published | None. Spec lists "Later" (spec line 304) |
| Gallery | `gallery` images with alt text | None published | Plus users only, rating filtered (`apps/delivery/src/app.ts`) |
| Header image | `header_image`, `hide_default_header_image` | None published | None |
| Background color | `background_color` | None published | Yes, `#rrggbb` with contrast check (`packages/core/src/color.ts`, `apps/web/lib/profile-page.ts`) |
| Organization flag | `is_organization`, auth | None published | Org accounts exist in the web app (`apps/web/app/account/orgs`); a public profile flag is Unknown |
| Section visibility flags | `section_visibility` (hidden_wallet, hidden_links and others) | None published | Whole-profile visibility rules only (`apps/web/app/account/visibility/page.tsx`); per-section toggles Unknown |
| Registration date, last edit | `registration_date`, `last_profile_edit`, auth | None published | Unknown |
| Atproto apps list | None | None | Yes, `atprotoApps` in profile JSON |

## 3. Profile export formats

| Format | Gravatar | Libravatar | blueyvatar today |
| --- | --- | --- | --- |
| JSON | `.json` suffix, PoCo format, JSONP `callback` ([JSON docs](https://docs.gravatar.com/profiles/json/)) | None published | `GET /profile/:id` returns JSON on delivery (`apps/delivery/src/app.ts`); no `.json` suffix route; no download button |
| Markdown | `.md` suffix ([LLMs guide](https://docs.gravatar.com/guides/llms-txt/)) | None published | None |
| vCard | `.vcf` suffix; not all fields included, field list not published ([vCard docs](https://docs.gravatar.com/profiles/vcf-vcard/)) | None published | None |
| XML | `.xml` ([LLMs guide](https://docs.gravatar.com/guides/llms-txt/)) | None published | None |
| PHP serialized | `.php` ([LLMs guide](https://docs.gravatar.com/guides/llms-txt/)) | None published | None |
| Account data export (owner) | Unknown | Unknown | JSON download at `/account/data/export` (`apps/web/app/account/data/export/route.ts`) |

Note: the OpenAPI spec defines no export endpoints ([OpenAPI](https://api.gravatar.com/v3/openapi)). The suffix formats above are documented on the docs pages cited.

## 4. QR codes

| Feature | Gravatar | Libravatar | blueyvatar today |
| --- | --- | --- | --- |
| Profile QR | `https://gravatar.com/{hash}.qr` or `{username}.qr`; also `/qr-code/{sha256_hash}` in the API, PNG ([QR docs](https://docs.gravatar.com/sdk/qr-codes/), [OpenAPI](https://api.gravatar.com/v3/openapi)) | None published | `/qr/{id}.svg` and `.png` (`apps/delivery/src/app.ts`) |
| Size | `s` or `size`, default 80 | n/a | `s`, default 256, tier clamped (`docs/api/gravatar-differences-v1.md`) |
| Style | `version=1` standard, `version=3` small dots | n/a | One style, ECC M, 4 module quiet zone (`packages/core/src/qr.ts`) |
| Center image | `type=user` (avatar), `type=gravatar` (logo), blank for none | n/a | None. No logo, no avatar overlay |
| Redirect to a social account | Unknown | n/a | `?to=<platform>` via `/go/:handle/:platform` (`apps/delivery/src/app.ts`) |
| Encoded content | Link to the profile page only | n/a | Profile URL, or the `/go` redirect URL |
| Access | Unknown (no tier restriction published on the pages read) | n/a | Every plan, including anonymous callers (`apps/delivery/src/app.ts`) |

## 5. Hovercards, embeds, widgets

| Feature | Gravatar | Libravatar | blueyvatar today |
| --- | --- | --- | --- |
| Hovercards | `gprofiles.js` plus `hovercard` class or `data-gravatar-hash` ([docs](https://docs.gravatar.com/hovercards/)) | None published | `@blueyvatar/hovercards`, served at `/embed/hovercard.js`; Business and Enterprise for cross-origin use (`packages/hovercards/README.md`). Package unpublished |
| Profile card embed | oEmbed endpoint and `.card` iframe, 415 by 228 px ([profiles SDK](https://docs.gravatar.com/sdk/profiles/)) | None published | None found (no oEmbed or card route in `apps/`) |
| Avatar component | Quick Editor, Avatars and Profiles components, Android and iOS SDKs ([REST docs](https://docs.gravatar.com/rest/api-data/)) | Libraries and plugins for many platforms ([home](https://libravatar.org/)) | `@blueyvatar/avatar` JS builder and React component, unpublished (`packages/avatar/README.md`) |
| WordPress | Gravatar Enhanced plugin ([profiles SDK](https://docs.gravatar.com/sdk/profiles/)) | Plugins listed, specifics Unknown ([home](https://libravatar.org/)) | Integration docs and a PHP test (`docs/integrations/wordpress-v1.md`) |
| Other integrations | Unknown beyond the WordPress plugin and a Foreign Data Wrapper ([REST docs](https://docs.gravatar.com/rest/api-data/)) | Unknown | Discourse, Ghost, plain HTML docs (`docs/integrations/`) |

## 6. API

| Feature | Gravatar | Libravatar | blueyvatar today |
| --- | --- | --- | --- |
| Profile API | REST v3, `GET /profiles/{id}`, OpenAPI published ([REST docs](https://docs.gravatar.com/rest/api-data/)) | None published | `GET /profile/:id`, OpenAPI at `/openapi.json` (`apps/delivery/src/app.ts`, `docs/api/README-v1.md`) |
| Write API | `PATCH /me/profile`, avatar upload endpoints, OAuth ([OpenAPI](https://api.gravatar.com/v3/openapi)) | Unknown | Writes go to the person's atproto repo through atproto scopes (spec section 10.1); no write REST API |
| Search by verified account | `/profiles/search/by-verified-account` ([OpenAPI](https://api.gravatar.com/v3/openapi)) | None published | None found |
| Rate limits | 1,000 requests per hour per API key for Profiles; avatars not limited ([REST docs](https://docs.gravatar.com/rest/api-data/)) | Unknown | Anonymous 100 per day per IP; Free keyed 1,000 per day; paid monthly caps (`packages/core/src/tiers.ts`) |
| Error format | `error` and `code` fields | Unknown | `errorBody` with code and message (`docs/api/errors-v1.md`) |

## 7. Federation and lookup

| Feature | Gravatar | Libravatar | blueyvatar today |
| --- | --- | --- | --- |
| DNS SRV discovery | None published | `_avatars._tcp` and `_avatars-sec._tcp`; fallback to `seccdn.libravatar.org` ([API](https://wiki.libravatar.org/api/)) | Design memo only; no code (`docs/research/dns-delegation-v2.md`) |
| Self-hostable | Unknown | Yes, ivatar under AGPLv3 ([home](https://libravatar.org/)) | Yes, `docs/self-hosting-v1.md` |
| OpenID identifiers | None published | Yes ([API](https://wiki.libravatar.org/api/)) | Not carried over; DID and handle instead (spec section 3 row 5) |
| Identity key | Email hash, primary email only for profiles ([REST docs](https://docs.gravatar.com/rest/api-data/)) | Email or OpenID hash | Email hash, handle, or DID |
| Import from other services | Unknown | Unknown | Import from Bluesky, Gravatar, Libravatar (`apps/web/lib/import.ts`) |

## 8. Privacy and consent

| Feature | Gravatar | Libravatar | blueyvatar today |
| --- | --- | --- | --- |
| Default profile visibility | "All profile information is public" with per-section toggles under Design ([support](https://support.gravatar.com/your-profile/)) | Unknown; privacy policy is linked but not read ([home](https://libravatar.org/)) | Public unless visibility rules restrict it (`apps/web/app/account/visibility/page.tsx`) |
| Hide a whole profile | `disabled` error code exists ([REST docs](https://docs.gravatar.com/rest/api-data/)); user flow Unknown | Unknown | `hiddenProfile` returns 404 (`apps/delivery/src/app.ts`) |
| Hide verified accounts | `is_hidden`, `hidden_verified_accounts` | None published | `hidden` flag per account |
| Wallet and contact consent | Wallet and contact info appear only when the user adds and makes them public ([OpenAPI](https://api.gravatar.com/v3/openapi)) | None published | Not applicable yet; no such fields |
| Ownership proof for social links | Verified accounts via connected services ([support](https://support.gravatar.com/your-profile/)); proof for plain links Unknown | None published | Verified accounts use attestation; plain atproto links are self-declared (`packages/core/src/links.ts`) |
| Abuse reporting | Report abuse form ([REST docs footer](https://docs.gravatar.com/rest/api-data/)) | Unknown | Report form (`apps/web/app/report`) and moderation (`docs/moderation-v1.md`) |
| Profile view tracking | Unknown | Unknown | Aggregate daily counter, no IP or cookie (`apps/web/app/p/[handle]/page.tsx`) |

## 9. Pricing

| Feature | Gravatar | Libravatar | blueyvatar today |
| --- | --- | --- | --- |
| End user | Free; paid details for end users Unknown | Free service; pricing not mentioned on the home page ([home](https://libravatar.org/)) | Free, Plus $9 per month (`apps/web/lib/pricing.ts`) |
| Developer | Free tier with attribution; paid from $100 per month with SLA and support ([pricing](https://docs.gravatar.com/pricing)) | None published | Free, Plus $9 (includes 50,000 keyed requests a month), Business $49 per month, Enterprise by contract (`apps/web/lib/pricing.ts`, `packages/core/src/tiers.ts`) |

## 10. Other features found

| Feature | Gravatar | Libravatar | blueyvatar today |
| --- | --- | --- | --- |
| Multiple avatars per account | Yes, one selected ([OpenAPI](https://api.gravatar.com/v3/openapi) `/me/avatars`) | Unknown | Free 3, Plus 20 (`docs/api/gravatar-differences-v1.md`) |
| Per-email avatar | Each email can have its own image ([Gravatar FAQs](https://support.gravatar.com/basic/), as recorded in `docs/research/gravatar-gaps-v1.md`) | Unknown | One avatar per DID |
| Upload crop rule | 1:1 required, `uncropped_image` error ([REST docs](https://docs.gravatar.com/rest/api-data/)) | Unknown | Crop tool in upload flow (`apps/web/lib/crop.ts`) |
| Open source | Unknown for the service; SDKs on GitHub ([REST docs](https://docs.gravatar.com/rest/api-data/)) | Yes, AGPLv3 | Licensed, see `LICENSE` files |
| Developer console | API Explorer and dashboard ([REST docs](https://docs.gravatar.com/rest/api-data/)) | Domain check tool ([API](https://wiki.libravatar.org/api/)) | Keys page at `/account/keys` |
| Gravatar-compatible URL shape | n/a | Yes, closely mirrors Gravatar | Yes, `/avatar/{hash}` |

## Rows marked Unknown

See the Unknown cells above. The main open items are:

1. Gravatar: initials param on Libravatar, robohash set on Gravatar, file extension and output format on Libravatar, fallback chain, QR tier restriction, end-user paid plans, service license.
2. Libravatar: all profile field, export, QR, hovercard, embed, rate limit, privacy and per-email questions.
3. blueyvatar: verified service list, public org flag, per-section visibility, registration date.
4. Gravatar vCard field list (not published).
5. Gravatar anonymous profile rate limit (not published).
