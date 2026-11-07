# Errors, rate limits, and response headers (v1)

## Error body

Every error from the delivery API is JSON:

```json
{
  "error": {
    "code": "invalid_ttl",
    "message": "ttl must be between 1h and 28d, for example 6h or 7d",
    "docs": "https://blueyvatar.com/docs/errors#invalid_ttl"
  }
}
```

Branch on `code` and the HTTP status. `code` is stable. `message` is for people and may change. `docs` links to the anchor below.

## Error codes

| Code | Status | Meaning |
| --- | --- | --- |
| `invalid_identifier` | 400 | The path identifier is malformed. `/avatar/{hash}` needs a 64-hex SHA-256 or 32-hex MD5 hash. `/u/{id}` needs a handle or DID. `/profile/{id}` and `/qr/{id}` need a SHA-256 hash, handle, or DID. Emails are always invalid. |
| `invalid_size` | 400 (404 on `/img`) | `s` is not an integer of at least 1. Values above the tier maximum are clamped, not rejected. On `/img`, a size outside 1 to 2048 returns this code with status 404. |
| `invalid_default` | 400 | `d` is neither a known style nor a parseable URL. |
| `default_url_not_allowed` | 400 | `d` is a URL that is not HTTPS or whose host is not on the allowlist. |
| `invalid_rating` | 400 | `r` is not `g`, `pg`, `r`, or `x`. |
| `invalid_format` | 400 | `fmt` is not `png`, `jpeg`, or `webp`. |
| `invalid_quality` | 400 (404 on `/img`) | `q` is not an integer from 1 to 100. On `/img`, a `-q` value outside 1 to 100 returns this code with status 404. |
| `invalid_ttl` | 400 | `ttl` is not `<n>h` or `<n>d` within 1h to 28d. |
| `invalid_key` | 401 | Unknown API key, or a secret key sent outside the `x-api-key` header. |
| `license_inactive` | 402 | The key's license is not active. The message names its status. |
| `origin_not_allowed` | 403 | A publishable key was used from an origin or referer not on its domain list, or with none. |
| `tier_required` | 403 | The route needs a higher tier. `/qr` requires Business or Enterprise. |
| `origin_forbidden` | 403 | The request did not come through the CDN. Raised only where the origin lock is enabled. |
| `access_denied` | 403 | The profile exists but its visibility rules exclude this caller (keyed-only or domain allowlist). |
| `not_found` | 404 | No such image, profile, or route target. Also returned for `d=404` with no avatar, and for hidden profiles. |
| `rate_limited` | 429 | Anonymous daily limit (100 per IP) or Free keyed daily limit (1,000) reached. |
| `upstream_error` | 502 | The image could not be fetched or processed. |
| `profile_hidden` | none | Reserved. Defined in code and not emitted today. Hidden profiles return `not_found`. |

Unhandled server faults return a framework default 500 that is not in this JSON shape. Treat any non-JSON 5xx as a transient failure.

Parameters that a tier ignores are not errors. They are listed in `x-adjusted-params`.

## Rate limit headers

Sent on successful responses and on `429` responses, when the caller has a counted window:

| Header | Value |
| --- | --- |
| `x-rate-limit-limit` | Requests allowed in the current window. |
| `x-rate-limit-remaining` | Requests left. Never below 0. |
| `x-rate-limit-reset` | Unix time in seconds when the window resets. |

Windows: anonymous callers get 100 per day per IP. Free keys get 1,000 per day. Pro and Business have monthly included volume of 50,000 and 1,000,000 (30-day window), with metered overage, so they are not blocked at the limit. Enterprise has no window and the three headers are omitted. The API does not send `retry-after`. On a `429`, wait until `x-rate-limit-reset`.

## Other response headers

| Header | When | Value |
| --- | --- | --- |
| `x-tier` | Successful responses | `free`, `pro`, `business`, or `enterprise`. |
| `x-usage-cost` | Successful keyed requests | `1`, the metered units for the request. Absent for anonymous requests. |
| `x-adjusted-params` | A tier clamped or ignored a parameter | Comma-separated names, for example `s,fmt,ttl`. Possible names: `s`, `d`, `fmt`, `q`, `ttl`. On `/qr`, only `s` is reported. |
| `x-cache-status` | `/img/...` responses from the origin | `MISS`. The origin always sets `MISS`, and a CDN in front may report its own status. |
| `x-content-type-options` | Every response | `nosniff`. |
| `cache-control` | Avatar, JSON, and QR responses | `private, max-age=<ttl>`. See [cache-ttl-v1.md](cache-ttl-v1.md). |

Browser code can read `x-rate-limit-limit`, `x-rate-limit-remaining`, `x-rate-limit-reset`, and `x-tier` on `/profile/{id}` responses. Those routes send CORS headers allowing any origin. Other routes do not expose these headers to cross-origin scripts.
