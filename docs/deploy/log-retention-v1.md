# Log retention

Policy (issue #146, owner decision): logs are kept 90 days or until a size cap is reached, whichever comes first. The same sentence is published on `/privacy`. This section covers request logs, logs held in our own database, and the settings that make every store agree.

### Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOG_RETENTION_DAYS` | `90` | Age limit in days. Values above 90 are clamped to 90, because 90 is the published ceiling. Lower it only if you also change `/privacy`. |
| `LOG_RETENTION_MAX_GB` | `5` | Size cap in gigabytes, applied to each log store separately (the log destination and the database). Invalid values fall back to the default. |

Both are read by delivery, which runs the database purge. Set them as Fly secrets or in `fly/delivery.toml` `[env]`. The log destination has its own settings, listed below, and must be set to the same two numbers by hand.

### Why 5 GB

No traffic data exists yet (spec section 11 calls its numbers placeholders), so the default comes from arithmetic on what the code logs. Delivery writes one JSON line per request with level, app, message, time, route pattern, status, duration, and request id (see Observability, Logging). That is about 250 to 350 bytes, so call it 300 bytes with shipper metadata. Cloudflare caches `/img/*` and serves the rate limit and redirect traffic from the edge only on hits, so the origin sees a fraction of all requests.

| Origin requests per day | Lines in 90 days | Size in 90 days at 300 bytes |
| --- | --- | --- |
| 10,000 | 0.9 million | 0.3 GB |
| 100,000 | 9 million | 2.7 GB |
| 185,000 | 16.7 million | 5 GB |
| 1,000,000 | 90 million | 27 GB |

A 5 GB cap therefore never bites below about 185,000 origin requests per day, so at launch volumes the 90 day limit is the one that applies, and the cap is a guard against a traffic spike or a log-spam bug filling the destination. Above that volume the cap wins and older lines drop earlier than 90 days, which the policy allows. The figure is also small enough to fit common free or low cost tiers of log destinations (confirm against the vendor, see below). Revisit it after the first month of real traffic: multiply the daily line count by 300 bytes and by 90.

### Database-held logs

Delivery runs `enforceLogRetention` (`apps/delivery/src/log-retention.ts`) a minute after start and then daily:

- `reports.ip_hash` is set to NULL once a report is older than the age limit. The report row stays, because it records a takedown decision and holds no request data. The hash only drives the per-IP report rate limit, which looks back far less than 90 days. Migration 0020 drops the NOT NULL constraint for this.
- `stripe_events` rows (processed webhook event ids) older than the age limit are deleted. Stripe stops retrying a webhook within days, so a 90 day idempotency window is ample.
- Size cap: if the live bytes of those two (event rows plus kept IP hashes) exceed `LOG_RETENTION_MAX_GB`, the oldest rows across both go first, in batches of 1,000, until the total fits.
- `profile_view_counters` (issue #173, migration 0025) holds one row per DID per UTC day with two counters: `views` (non-bot renders of `/p/{handle}`, written by web) and `json_calls` (keyed `/profile/{id}` calls, written by delivery next to the `profile_json` meter). It stores no IP address, user agent, or cookie. Rows from days before the age limit are deleted, and the rows count toward the size cap (oldest first). The age limit is the same 90 days, not a separate period, so `/privacy` states one number. Plus members read the last 30 days at `/account/stats`; the rows are in the account data export and removed by account deletion.
- `rate_windows` is already cleaned hourly by `rate-cleanup.ts` once its window ends (minutes), well inside the policy.
- Not logs, so not purged here: `usage_alerts`, `usage_counters`, and `service_usage_counters` (billing and quota accounting, one row per period), and `oauth_state` and `email_codes` rows that expire in minutes.

Check a run in the delivery logs for `log retention purge` (printed only when something was removed). A purge failure logs `log retention purge failed` and retries the next day.

### Fly and external log retention

Fly keeps logs only briefly for `fly logs`; the exact window is **unconfirmed** (not stated in the Fly docs we have read), so treat it as shorter than 90 days and never as the record of retention. Nothing is shipped yet. Until a destination is set up, request logs live only in Fly's short buffer, which is within the policy (shorter than 90 days) but gives no look-back for abuse investigations. To meet the policy with look-back, ship logs and set the destination as follows. Vendor details below are **unconfirmed**: verify each on the vendor's current docs and record the date when you do.

1. Ship with Fly's log shipper, an app that reads Fly's NATS log stream and forwards it: <https://github.com/superfly/fly-log-shipper>. Run it as its own Fly app with a read-only org token. It supports several sinks (Axiom, Loki, Datadog, and others, per its README).
2. At the destination, set retention to 90 days and a 5 GB (or `LOG_RETENTION_MAX_GB`) cap:
   - Grafana Loki: `retention_period: 2160h` (90 days) with the compactor's `retention_enabled: true`. Loki has no total size cap setting that we have confirmed, so watch storage and lower `retention_period` if needed, or use a destination below.
   - Axiom: set the dataset retention to 90 days in the dataset settings. A size cap is not a dataset setting we have confirmed; the plan's ingest limit is the practical cap.
   - Any other sink: both a 90 day expiry and a size limit must exist, or a scheduled job must enforce them. If a sink cannot, do not choose it.
3. Cost at expected volume: at the table above, 0.3 to 2.7 GB per 90 days is within free tiers at several vendors, but plan limits change and are **unconfirmed** here. Owner action: confirm the plan and that a paid destination is acceptable (the issue asked).
4. Logs must never carry client IPs, query strings, cookies, keys, or raw DIDs, because the logger removes them before they reach any sink (Observability, Logging). Per request, a shipped line holds timestamp, route pattern, status, duration, and request id. The key id and a user agent length class from the issue's field list are not logged; that is stricter than required.
