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
| `invalid_platform` | 400 | `to` on `/qr` is not a lowercase platform name such as `github`. |
| `invalid_key` | 401 | Unknown API key, or a secret key sent outside the `x-api-key` header. |
| `key_expired` | 401 | The key's expiration time has passed. Create a new key on the API keys page. |
| `license_inactive` | 402 | The key's license is not active. The message names its status. |
| `origin_not_allowed` | 403 | A publishable key was used from an origin or referer not on its domain list, or with none. |
| `tier_required` | 403 | The route needs a higher tier. QR codes (`/qr`) are available on every plan, and cross-origin `/profile` (hovercards) requires Plus or higher. |
| `origin_forbidden` | 403 | The request did not come through the CDN. Raised only where the origin lock is enabled. |
| `secret_key_required` | 403 | `GET /usage` was called with a publishable key. Use a secret key in the `x-api-key` header. See [usage-v1.md](usage-v1.md). |
| `access_denied` | 403 | The profile exists but its visibility rules exclude this caller (keyed-only or domain allowlist). |
| `invalid_signature` | 403 | An `/img` path is unsigned, or its signature does not match the file name. Fetch the avatar again through `/avatar` or `/u`. |
| `signature_expired` | 403 | A signed `/img` path for a restricted avatar is past its day bucket. Fetch the avatar again. |
| `not_found` | 404 | No such image, profile, or route target. Also returned for `d=404` with no avatar, for hidden profiles, and on `/img` when the user's PDS answers 404 for the original blob. |
| `rate_limited` | 429 | Anonymous daily limit (100 per IP) or Free keyed daily limit (1,000) reached. |
| `upstream_error` | 502 | The image could not be fetched or processed. On `/img` this covers PDS 5xx responses, timeouts, network errors, an unusable PDS endpoint, and bytes that do not match the CID. |
| `internal` | 500 | An unhandled server fault. |
| `overloaded` | 503 | Image processing is at capacity: the resize queue is full or the wait ran out. Returned by `/img`, `/default`, and PNG `/qr`. Carries `retry-after` (seconds) and `cache-control: no-store`; retry after the delay. |
| `not_ready` | 503 | `GET /readyz` only: a dependency check (Postgres) failed or timed out. Not returned by avatar or profile routes. |

Unhandled server faults return `500` with code `internal` in the same JSON shape. Treat 5xx as transient and retry with backoff. Hidden profiles return `not_found`, the same as an unknown profile, so a lookup cannot reveal that a profile exists.

### When you see a 5xx

`500 internal` and `502 upstream_error` are transient. Retry with exponential backoff and a cap. If they persist, send the `x-request-id` response header (also `request_id` in the error body) to the operator contact, which ties your report to a log line. blueyvatar does not publish a public status page yet. The service is watched from an external dashboard (see `docs/research/status-page-v1.md`), so an outage reaches the operator without your report.

### Original blob fetch (`/img`)

On a CDN miss, delivery fetches the original from the user's PDS (`com.atproto.sync.getBlob`):

- The PDS endpoint from the DID document must be a public https host. A bare hostname gets `https://`. Other schemes, credentials, ports, IP literals, and local names are refused and answer `502 upstream_error`.
- PDS `404` answers `404 not_found`. It is not retried and does not mark the host as failing.
- PDS `5xx`, timeouts, and network errors are retried up to 2 times with a short backoff (100 ms, then 300 ms). If all attempts fail the answer is `502 upstream_error`.
- After such a failure, the PDS host is skipped for 30 seconds and requests for it answer `502 upstream_error` at once. A later success clears the mark.
- Other PDS 4xx responses answer `502 upstream_error` without retry.
- Each outcome is logged as `getBlob` with the fields `outcome`, `did`, `cid`, `host`, `status`, `attempt`, `bytes`. Tokens and URLs are never logged.

Parameters that a tier ignores are not errors. They are listed in `x-adjusted-params`.

## Rate limit headers

Sent on successful responses and on `429` responses, when the caller has a counted window:

| Header | Value |
| --- | --- |
| `x-rate-limit-limit` | Requests allowed in the current window. |
| `x-rate-limit-remaining` | Requests left. Never below 0. |
| `x-rate-limit-reset` | Unix time in seconds when the window resets. |

Windows: anonymous callers get 100 per day per IP. Free keys get 1,000 per day. Plus and Business have monthly included volume of 50,000 and 1,000,000 (30-day window), with metered overage, so they are not blocked at the limit. Enterprise has no window and the three headers are omitted. A `429` also carries `retry-after`, the whole seconds (at least 1) until `x-rate-limit-reset`.

## Other response headers

| Header | When | Value |
| --- | --- | --- |
| `x-tier` | Successful responses | `free`, `plus`, `business`, or `enterprise`. |
| `x-usage-cost` | Successful keyed requests | `1`, the metered units for the request. Absent for anonymous requests. |
| `x-adjusted-params` | A tier clamped or ignored a parameter | Comma-separated names, for example `s,fmt,ttl`. Possible names: `s`, `d`, `fmt`, `q`, `ttl`. On `/qr`, only `s` is reported. |
| `retry-after` | `429` responses with a counted window | Seconds to wait before retrying. |
| `x-content-type-options` | Every response | `nosniff`. |
| `cache-control` | Avatar, JSON, and QR responses | `private, max-age=<ttl>`. See [cache-ttl-v1.md](cache-ttl-v1.md). |

The API does not send `x-cache-status`. Cloudflare reports cache state in `cf-cache-status`.

Browser code can read `x-rate-limit-limit`, `x-rate-limit-remaining`, `x-rate-limit-reset`, and `x-tier` on `/profile/{id}` responses. Those routes send CORS headers allowing any origin. Other routes do not expose these headers to cross-origin scripts.
