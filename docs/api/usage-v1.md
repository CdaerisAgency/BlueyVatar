# Usage API (v1)

Version 1. `GET /usage` returns the metered usage of the license behind a secret key, so you can watch consumption from code. The dashboard at `/account/keys` shows the same numbers.

## Request

```
GET /usage
x-api-key: sk_...
```

- Secret keys only, sent in the `x-api-key` header. The `token` query parameter is not accepted.
- A publishable key gets `403` with the error code `secret_key_required`. A missing or unknown key gets `401` (`invalid_key`). An inactive license gets `402` (`license_inactive`).
- The call counts toward your rate limit like any keyed request, and sends the usual `x-rate-limit-*` headers. It is not metered: it adds nothing to your usage and sends no `x-usage-cost` header.
- Responses are `cache-control: private, no-store`. The route sends no CORS headers, because secret keys belong on servers.

## Response

```json
{
  "tier": "pro",
  "period": { "start": "2026-11-01", "end": "2026-11-30" },
  "included": { "volume": 50000, "per": "month" },
  "total": 1234,
  "meters": { "origin_resolution": 1234, "profile_json": 56, "transform": 0 },
  "history": {
    "months": [
      { "period": "2026-11-01", "origin_resolution": 1234, "profile_json": 56, "transform": 0 },
      { "period": "2026-10-01", "origin_resolution": 40210, "profile_json": 902, "transform": 0 }
    ],
    "days": [
      { "date": "2026-11-07", "origin_resolution": 210, "profile_json": 9 }
    ]
  }
}
```

| Field | Meaning |
| --- | --- |
| `tier` | `free`, `pro`, `business`, or `enterprise`. |
| `period` | The current billing period: the UTC calendar month, first and last day. |
| `included` | Included keyed volume. `volume` is `null` for Enterprise (contract). `per` is `month` for Pro and Business, `day` for Free, and `null` for Enterprise. |
| `total` | Origin resolutions so far this period. This is the number that counts toward included volume. |
| `meters` | This period's count for each meter: `origin_resolution`, `profile_json`, `transform`. |
| `history.months` | Monthly counts, newest first, including the current month. |
| `history.days` | Daily counts for `origin_resolution` and `profile_json`, newest first, one entry per UTC day including days with no traffic. Days run from 00:00 to 24:00 UTC. |

## History window by tier

| Tier | `history.months` | `history.days` |
| --- | --- | --- |
| Free | none (use `meters` for the current period) | none |
| Pro | 2 months (this and last) | last 30 days |
| Business | 12 months | last 30 days |
| Enterprise | 12 months | last 30 days |

Daily counts start on the day this feature shipped. Earlier days show `0`. Monthly counters are unchanged and remain the source for billing and usage alerts.

Source of truth: `apps/delivery/src/app.ts` (route), `packages/core/src/usage-window.ts` (windows), `db/migrations/0024_usage_daily.sql` (daily table).
