# JSON response mode (v1)

Add `json=true` to an avatar request (`/avatar/{hash}` or `/u/{id}`) to receive metadata instead of a redirect. Only the exact value `true` enables it.

## Response

`200 application/json`:

```json
{
  "did": "did:plc:abc123",
  "handle": "ada.example.com",
  "found": true,
  "source": "blueyvatar",
  "rating": "g",
  "url": "/img/did%3Aplc%3Aabc123/bafkreiexample/80.png",
  "updatedDate": "2026-01-02T03:04:05.000Z"
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `did` | string or null | The resolved DID. `null` when nothing is visible to the caller. |
| `handle` | string or null | The handle, when the identity has one. |
| `found` | boolean | `true` when an image passed the `r` rating filter and `f` is not `y`. |
| `source` | string | Where the image came from: `blueyvatar`, `adapter:<name>`, or `blueyvatar-default`. The value is `default` when `found` is `false`. |
| `rating` | string or null | `g`, `pg`, `r`, or `x` for the chosen image. `null` when `found` is `false`. |
| `url` | string or null | Path of the immutable resized image, relative to the base URL. `null` when `found` is `false`. |
| `updatedDate` | string or null | ISO 8601 time the chosen image record was indexed, the closest match to Gravatar's `updated_date`. `null` when `found` is `false` and for images read from another app's profile (such as the Bluesky avatar), which carry no timestamp. |

`url` follows the same `s`, `fmt`, and `q` parameters as the redirect, with two adjustments. The size snaps up to the nearest step of the size ladder (16, 24, 32, 48, 64, 80, 96, 128, 160, 192, 256, 320, 512, 1024, 2048), so `s=100` yields `/128.png`. For `jpeg` and `webp`, `q` snaps to the nearest allowed quality, 60 or 85. Quality 85 is the default and has no suffix. Quality 60 adds `-q60`, for example `/80-q60.webp`. PNG ignores `q`. Fetch the path with a normal GET. `/img` URLs need no key.

## Behavior

- Entitlements, key checks, visibility rules, and metering match the redirect route. Each request counts as one origin resolution.
- `Cache-Control: private, max-age=<ttl>` applies, as on the redirect. See [cache-ttl-v1.md](cache-ttl-v1.md).
- A well-formed request with `json=true` always gets `200` JSON. When the lookup finds nothing, the repo is inactive, or visibility rules deny the caller, the body is `{"did": null, "handle": null, "found": false, "source": "default", "rating": null, "url": null, "updatedDate": null}`. All of these cases return the identical body, so a hash lookup cannot reveal whether a hash is linked to a restricted or inactive account. `d` is ignored in JSON mode.
- Malformed requests (bad identifier or parameter) and key or rate limit failures still return the standard error body.
- Errors use the standard error body. See [errors-v1.md](errors-v1.md).

## Version policy

This page describes v1, the only version today.

- Within v1, changes are additive. New fields may appear, so clients must ignore fields they do not know. Existing fields keep their name, type, and meaning.
- A breaking change (removing or renaming a field, changing a type or meaning) ships under a new `v` query parameter or a new path, and v1 behavior stays available for a published deprecation period.
- The response does not carry a version field. Requests without `v` receive v1.

`/profile/{id}` returns a separate JSON document with its own shape. It follows the same version policy.

The `/profile/{id}` document includes `gallery`, an array of `{ "url": string, "caption": string or null }` with at most 12 entries. It is `[]` unless the profile owner is on the Plus plan. Each `url` is a signed `/img` path (512 pixel PNG) and follows the same visibility, rating, and blocklist rules as the avatar. Gallery images are never returned by the avatar routes.
