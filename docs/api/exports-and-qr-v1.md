# Profile exports and QR codes (v1)

Part of issue #242. Both features are available to every plan and every caller. They follow the same caching, rate limit, rating, and hidden-profile rules as the routes they extend.

## Profile exports

`GET /profile/{id}` returns the profile JSON. Add a suffix to the id, or send `format=`, to download the public fields as a file.

| URL | Content-Type | Download name |
| --- | --- | --- |
| `/profile/{id}.json` or `?format=json` | `application/json; charset=utf-8` | `{handle}.json` |
| `/profile/{id}.md` or `?format=md` | `text/markdown; charset=utf-8` | `{handle}.md` |
| `/profile/{id}.vcf` or `?format=vcf` | `text/vcard; charset=utf-8` | `{handle}.vcf` |

`{id}` is a handle, DID, or SHA-256 hash, as for the profile JSON. Every export sends `Content-Disposition: attachment`, `x-content-type-options: nosniff`, and `cache-control: private, max-age=300`. Unknown, hidden, and inactive profiles answer `404 not_found`. A restricted profile answers `403 access_denied` to callers it does not allow, exactly like `/profile/{id}`. Each request counts once toward the `profile_json` meter.

The existing `/profile/{id}` URL is unchanged. A handle can end in `.md`, because `.md` is a real top-level domain, so `/profile/{handle}.md` is read as that handle first. Only when no such handle exists does it become the Markdown export of the shorter handle. For a handle that ends in `.json`, `.md`, or `.vcf`, use `?format=` to get an export without any doubt. An unknown `format` value is ignored.

### What an export contains

Display name, handle, profile page URL, description, avatar URL (a signed image URL, not image bytes), location, job title, company, pronouns, interests, languages, links (from your atproto profile and your own social links), verified accounts you have not hidden, and only the wallets you chose to show. Each wallet is marked not verified. Exports are built from the public profile JSON, so they never include hidden wallets, email links or hashes, your DID, your plan, or anything that only you can see.

### vCard properties

The file is vCard 4.0 ([RFC 6350](https://www.rfc-editor.org/rfc/rfc6350)) with CRLF line endings and lines folded at 75 octets.

| Property | Source | Section |
| --- | --- | --- |
| `VERSION:4.0` | Fixed. Placed right after `BEGIN:VCARD`. | RFC 6350 6.7.9 |
| `BEGIN`, `END` | Fixed. | RFC 6350 6.1.1, 6.1.2 |
| `FN` | Display name, or the handle. Required. | RFC 6350 6.2.1 |
| `N` | Not written. It SHOULD be present only when the name follows the X.520 model, and a display name cannot be split into family and given names without guessing. | RFC 6350 6.2.2 |
| `TITLE` | Job title. | RFC 6350 6.6.1 |
| `ORG` | Company, as the organization name component. | RFC 6350 6.6.4 |
| `PRONOUNS` | Pronouns. | RFC 9554 3.4 |
| `ADR` | Location. The seven components stay empty and the text goes in the `LABEL` parameter. | RFC 6350 6.3.1, RFC 9554 4.5 |
| `NOTE` | Description. | RFC 6350 6.7.2 |
| `CATEGORIES` | Interests, as a text list. | RFC 6350 6.7.1 |
| `LANG` | Each language tag (RFC 5646). The primary language gets `PREF=1`. | RFC 6350 6.4.4, 5.3 |
| `PHOTO` | The avatar URL. Image bytes are never embedded. | RFC 6350 6.2.4 |
| `URL` | The profile page, then each link from your atproto profile. | RFC 6350 6.7.8 |
| `SOCIALPROFILE` | Your own social links, and verified accounts with `SERVICE-TYPE` set to the platform name. | RFC 9554 3.5 and 4.9 |
| `X-BLUEYVATAR-WALLET` | Each shown wallet: the address is the value, with `X-CHAIN`, `X-LABEL`, and `X-VERIFIED=false` parameters. | RFC 6350 6.10 (extensions), 3.3 (`x-name`) |

Rules the writer follows:

- Text values escape backslash, comma, and newline (RFC 6350 3.4). A newline in any value becomes a backslash and `n`, so user text can never start a new property. A semicolon is escaped in structured values such as `ORG`. In plain text values the `text` rule in RFC 6350 4.1 has no escaped semicolon, so a semicolon is written as is.
- URI values (`PHOTO`, `URL`, `SOCIALPROFILE`) are written as is. The RFC's own `PHOTO` data URI example (6.2.4) has an unescaped comma and semicolon.
- Parameter values with a comma, semicolon, or colon are quoted. A double quote cannot appear in a parameter value (RFC 6350 3.3), so it is replaced with an apostrophe.
- Lines are folded after 75 octets, excluding the line break. A continuation line starts with one space that counts toward the 75, and a character is never split (RFC 6350 3.2).
- Link labels are not exported to vCard, because the RFC has no label parameter for `URL` or `SOCIALPROFILE`. `LABEL` is defined for `ADR` only.

Wallets have no standard vCard property. The `X-BLUEYVATAR-WALLET` name is ours and other programs will ignore it.

### Markdown

A heading with the display name, the handle with links to the profile page and avatar, the description, then Details, Languages, Links, Verified accounts, and Wallets (not verified) lists. All user text is backslash-escaped (CommonMark 2.4), so it cannot make a link, image, heading, list, or HTML tag. Link addresses are https only, with parentheses and angle brackets percent-encoded.

## QR codes

`GET /qr/{id}.png` and `/qr/{id}.svg` draw a QR code of the profile page URL, `https://blueyvatar.com/p/{handle}` on the main site.

| Parameter | Values | Default |
| --- | --- | --- |
| `s` or `size` | Wanted edge in pixels. Capped by tier as for avatars (Free 512, Pro 1024, Business and Enterprise 2048). | 256 |
| `center` | `none`, `logo` (the blueyvatar circle logo), or `avatar` (your current default avatar) | `none` |
| `quiet` | Quiet zone in modules, 4 to 16 | 4 |
| `to` | A verified platform: the code points at `/go/{handle}/{platform}` | none |
| `ttl` | As for avatars | 1d |

How the size is chosen:

1. The text decides the QR version, and the version decides the module count (17 + 4 × version per side).
2. The edge is the module count plus both quiet zones, times a whole number of pixels per module. That number is the largest one that fits in `s`, and never below 4. So a PNG can be a little smaller than `s`, and a very small `s` returns a larger image.
3. The `x-qr-version`, `x-qr-modules`, and `x-qr-pixels` headers report the result for PNG and for SVG with options.

A plain SVG with no options keeps its earlier shape (error correction level M, edge exactly `s`).

With `center=logo` or `center=avatar` the code uses error correction level H and a white plate in the middle. Level H restores about 30 percent of the codewords ([DENSO WAVE, error correction feature](https://www.qrcode.com/en/about/error_correction.html), ISO/IEC 18004). The plate covers at most half of that, 15 percent of the symbol area, and sits on a whole number of modules, centered. The image inside keeps its own aspect ratio and has one module of white around it.

`center=avatar` follows the avatar rules: rating `g`, the same blocked-image and label checks as `/img`, the image crop from the record, and the default avatar when there is no usable image. The bytes come from the owner's own server through the same resolver as the avatar routes, and no other URL is fetched.

Errors: `400 invalid_qr_option` for a bad `center` or `quiet`, and the codes in [errors-v1.md](errors-v1.md) for the rest.
