# Differences from Gravatar (v1)

The avatar routes accept the same query parameters as Gravatar, so most drop-in callers work unchanged. This page lists what is added and where BlueyVatar departs on purpose.

## Parameters that match

| Parameter | Behavior |
| --- | --- |
| `d=blank` | Returns a fully transparent PNG. The response is always PNG, even when `fmt=jpeg` or `fmt=webp` is sent, because JPEG has no transparency. |
| `name=` | On `/avatar/{hash}`, `d=initials` draws the first letters of the first two words of `name` (for `Ada Lovelace`, `AL`). Letters and digits only, uppercased. Names are cut at 100 characters. Without `name`, a hash lookup draws the silhouette. `/u/{id}` takes initials from the handle and ignores `name`. |
| `updatedDate` | Added to the JSON response. See [json-mode-v1.md](json-mode-v1.md). |

## Deliberate departures

| Area | Gravatar | BlueyVatar | Why |
| --- | --- | --- | --- |
| Avatar count | Unlimited uploads | Free 3 images, Plus 20 | Caps protect storage cost. |
| `d=<url>` | Any URL | HTTPS only, host on the service allowlist, and a Pro key or higher. Other callers get the style default and `x-adjusted-params: d`. | Prevents the redirect from being used as an open redirector. |
| Width and height | Square `s` only | Square `s` only. No `w` or `h`. | See [format-quality-v1.md](format-quality-v1.md). |
| Size cap | 2048 | Free 512, Pro 1024, Business and Enterprise 2048. Larger values are clamped and reported in `x-adjusted-params: s`. | Resize cost is billed by tier. |
| `d=pagan` | Not a Gravatar value | Supported | Extra default style. |
| `d=color` | Beta value | Not supported | Beta feature with no stable definition. |
| Email input | Hash of the email | SHA-256 or MD5 hash only. Raw email is always rejected. | Privacy. |
| Rating labels | PG and R defined by Gravatar's own rules | Mapped from atproto self-labels | One image has to rate the same in both places. |
| Per-email avatars | Each email can have its own image | One avatar per DID, shared by every linked hash | Fewer rows and less UI in v1. |

## QR default size

Gravatar's QR endpoint defaults to 80 pixels. `/qr/{id}.svg` and `/qr/{id}.png` default to 256 pixels, because a QR code at 80 pixels is hard to scan from a screen. This is a deliberate departure. Send `s=80` to match Gravatar. Tier size caps apply, and a PNG is never drawn below 4 pixels per module, so a very small `s` returns a slightly larger image. Gravatar's `type=user` and `type=gravatar` center images map to `center=avatar` and `center=logo`. See [exports-and-qr-v1.md](exports-and-qr-v1.md).
