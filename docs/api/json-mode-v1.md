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
  "url": "/img/did%3Aplc%3Aabc123/bafkreiexample/80.png"
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `did` | string | The resolved DID. |
| `handle` | string or null | The handle, when the identity has one. |
| `found` | boolean | `true` when an image passed the `r` rating filter and `f` is not `y`. |
| `source` | string | Where the image came from: `blueyvatar`, `adapter:<name>`, or `blueyvatar-default`. The value is `default` when `found` is `false`. |
| `rating` | string or null | `g`, `pg`, `r`, or `x` for the chosen image. `null` when `found` is `false`. |
| `url` | string or null | Path of the immutable resized image, relative to the base URL. `null` when `found` is `false`. |

`url` follows the same `s`, `fmt`, and `q` parameters as the redirect, with two adjustments. The size snaps up to the nearest step of the size ladder (16, 24, 32, 48, 64, 80, 96, 128, 160, 192, 256, 320, 512, 1024, 2048), so `s=100` yields `/128.png`. For `jpeg` and `webp`, `q` snaps to the nearest allowed quality, 60 or 85. Quality 85 is the default and has no suffix. Quality 60 adds `-q60`, for example `/80-q60.webp`. PNG ignores `q`. Fetch the path with a normal GET. `/img` URLs need no key.

## Behavior

- Entitlements, key checks, visibility rules, and metering match the redirect route. Each request counts as one origin resolution.
- `Cache-Control: private, max-age=<ttl>` applies, as on the redirect. See [cache-ttl-v1.md](cache-ttl-v1.md).
- JSON is returned only when the identity resolves and is visible to the caller. When the lookup finds nothing, the repo is inactive, or visibility rules deny the caller, the response is the normal default handling: a `302` to a default image, a `302` to your `d` URL, or `404 not_found` when `d=404`. Handle a non-JSON response in clients that send `json=true`.
- Errors use the standard error body. See [errors-v1.md](errors-v1.md).

## Version policy

This page describes v1, the only version today.

- Within v1, changes are additive. New fields may appear, so clients must ignore fields they do not know. Existing fields keep their name, type, and meaning.
- A breaking change (removing or renaming a field, changing a type or meaning) ships under a new `v` query parameter or a new path, and v1 behavior stays available for a published deprecation period.
- The response does not carry a version field. Requests without `v` receive v1.

`/profile/{id}` returns a separate JSON document with its own shape. It follows the same version policy.
