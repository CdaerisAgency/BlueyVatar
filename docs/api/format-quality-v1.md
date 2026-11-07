# Format, quality, and size (v1)

Output format and quality are chosen with `fmt` and `q` on `/avatar/{hash}` and `/u/{id}`. Sizes are always square.

## fmt

| Value | Meaning |
| --- | --- |
| `png` | Default. Lossless. Ignores `q`. |
| `jpeg` | Lossy. No transparency. |
| `webp` | Lossy. |

- Values are lowercase and exact. `gif`, `avif`, `jpg`, and `WEBP` return `400 invalid_format` on every tier.
- Free tier (including anonymous) gets PNG only. A valid `jpeg` or `webp` is ignored, the response is PNG, and it carries `x-adjusted-params: fmt`.
- Pro, Business, and Enterprise get all three formats.

## q

- Integer from 1 to 100. Default 85.
- Anything else (`0`, `101`, `abc`, `7.5`, empty) returns `400 invalid_quality` on every tier.
- Free tier ignores `q` and reports it in `x-adjusted-params`. For example `?fmt=webp&q=70` on Free yields `x-adjusted-params: fmt,q`.
- `q` has no effect on PNG output.

## How variants are cached

The redirect target encodes the format and quality, so each variant is its own immutable object:

```
/img/{did}/{cid}/{sig}/{size}[-q{quality}].{ext}
```

- `{ext}` is `png`, `jpeg`, or `webp`.
- `-q{quality}` appears only for `jpeg` and `webp` at a non-default quality. The cached qualities are 60 and 85, so `q` snaps to the nearest of those. 85 has no suffix, for example `/80.webp` and `/80-q60.webp`.
- `{size}` snaps up to the size ladder, as described in [json-mode-v1.md](json-mode-v1.md).
- The signature covers the file name, so a path for one variant cannot be edited into another. A request for a non-canonical name redirects to the canonical signed path.
- `/img` responses are `Cache-Control: public, max-age=31536000, immutable`, keyed by blob CID.

## Decision: square sizes only (no width or height)

There is no `w` or `h` parameter. Only `s`, which sets both sides.

Why:

- Avatars are square and are center-cropped to a square at upload, so a non-square output would need a second crop with no good default.
- Every new width and height pair would add its own cached object per CID, multiplying cache variants and purge cost. The size ladder keeps that set small and fixed.
- Gravatar uses a single square `s`. Staying square keeps drop-in parity with Gravatar clients (see [gravatar-differences-v1.md](gravatar-differences-v1.md)).

Callers who need a non-square box should request a square size and crop or fit it with CSS. This decision can be revisited if a concrete use case appears.
