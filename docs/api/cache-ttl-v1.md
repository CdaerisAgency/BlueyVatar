# Cache TTL (v1)

`ttl` sets how long a browser keeps the avatar response before asking again.

```
GET /avatar/{hash}?ttl=6h
```

## Format and limits

- Syntax: a whole number followed by `h` (hours) or `d` (days), such as `6h` or `7d`.
- Minimum `1h`. Maximum `28d`. Anything else returns `400 invalid_ttl`.
- Default: `24h`.

| Tier | `ttl` |
| --- | --- |
| Free (including anonymous) | Ignored. Fixed at 24h. The response carries `x-adjusted-params: ttl`. |
| Pro, Business, Enterprise | Honored, 1h to 28d. |

The value is validated for every tier, so a malformed `ttl` fails with `invalid_ttl` even on Free.

## What it controls

The value is written to `Cache-Control: private, max-age=<seconds>` on the redirect or JSON response from `/avatar/{hash}` and `/u/{id}`. It also applies to default-image redirects and `/qr` responses. `private` keeps shared caches from storing these responses, because they depend on key checks.

The redirect target is a separate URL, `/img/{did}/{cid}/{size}.{ext}`, keyed by the image CID. It is served with `public, max-age=31536000, immutable`. A new avatar has a new CID and so a new URL.

## Trade-off

| Longer ttl | Shorter ttl |
| --- | --- |
| Fewer requests to the delivery API, so faster page loads and lower metered usage | More requests, so more metered usage |
| An avatar change reaches a browser only after up to one ttl | Changes appear sooner |

A browser that cached the redirect keeps following it to the old image until `max-age` expires, even after the user changes their avatar. Pick the ttl you can tolerate for stale avatars.

## CDN warming and purge

- After an avatar change, the indexer requests the PNG sizes 48, 80, 128, 256, and 512 of the new `/img` URL so the CDN caches them. Other ladder sizes and formats are resized on the first request.
- When an image record is deleted or an account's labels or avatar change, the indexer purges every `/img` URL that can exist for the affected CIDs: all 15 ladder sizes, all three formats, and qualities 60 and 85 for JPEG and WebP (75 URLs per CID).
- `/img` serves only those canonical paths. A request with an off-ladder size, another quality, or a query string gets a `302` to the canonical path (`cache-control: public, max-age=3600`), so the purge set is complete.
- Purge applies to `/img` URLs only. A browser's cached redirect from `/avatar/{hash}` is outside the CDN's reach, so `ttl` is the only bound on how long that browser keeps the old target. Use a short `ttl` where fast propagation matters.
