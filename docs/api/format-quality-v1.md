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

- Avatars are square. Delivery crops the stored original to a square before resizing, using the crop saved on the image record when there is one and the center square otherwise (see "Crop and original size" below), so a non-square output would need a second crop with no good default.
- Every new width and height pair would add its own cached object per CID, multiplying cache variants and purge cost. The size ladder keeps that set small and fixed.
- Gravatar uses a single square `s`. Staying square keeps drop-in parity with Gravatar clients (see [gravatar-differences-v1.md](gravatar-differences-v1.md)).

Callers who need a non-square box should request a square size and crop or fit it with CSS. This decision can be revisited if a concrete use case appears.

## Crop and original size

The image record keeps the full original. Delivery makes the square.

- **Crop.** A `com.blueyvatar.image` record may carry `crop`, with integers `x`, `y`, and `size`, each in units of 1/10000 of the image. `x` is the left edge as a fraction of the width, `y` is the top edge as a fraction of the height, and `size` is the side as a fraction of the shorter side. Delivery applies it before it resizes to `s`. With no `crop`, delivery takes the center square. The values are measured on the image as displayed, with any EXIF orientation applied. A square that would leave the image is moved back inside it, and a `crop` with a missing or out-of-range value is ignored. The record format is in spec section 5.
- **Same URL, same crop.** An `/img` path is keyed by blob CID, so a crop is part of the cached image for that blob. The web editor writes the crop with the new record, and changing the crop of an existing record takes a new upload.
- **Upload size.** Any resolution is accepted. Images above 4096 pixels on the long side are shrunk to 4096 before they are stored, in the browser first and by the server as a fallback. The upload limit is 5 MiB (5,242,880 bytes). A larger file is rejected with an error that names the limit.
