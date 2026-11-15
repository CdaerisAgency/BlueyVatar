# Observability

Covers issue #143. Four parts: structured logs, health and readiness, error tracking, and metrics. Everything is off or inert by default, so local development and tests need no setup.

### Logging

Every app writes one JSON object per line to stdout (warn and error go to stderr, which Fly merges). Fields: `level`, `app` (`web`, `delivery`, `indexer`), `msg`, `time`, plus context. The helper is `createLogger` in `packages/core/src/observability`. It scrubs on the way out:

- A `did` field is replaced with `didHash`, the first 16 hex characters of its SHA256. Raw DIDs are not logged. (Some log lines still carry a `cid` or an event id; those are not personal data.)
- Fields whose names look like credentials or email (`authorization`, `x-api-key`, `token`, `cookie`, `password`, `secret`, `jwk`, `signature`, `email`) are replaced with `[redacted]`.
- Inside strings, email addresses become `[email]`, `Bearer` values are masked, and `token=`, `key=`, `sig=` query values are masked.
- Errors are logged as `name` and `message` only, never a stack.

`LOG_LEVEL` (`debug`, `info`, `warn`, `error`; default `info`) sets the minimum level. Delivery logs one `request` line per request with the route pattern (for example `/avatar/:hash`), status, and duration. It never logs the path parameters, query string, or client IP, so no handle, hash, or key reaches the log (spec section 9). Successful `getBlob` lines are `debug`; failures are `warn`. Fly keeps recent logs for `fly logs` only, and any longer retention needs a log shipper (**unconfirmed**, not researched here). The spec requires a short, published retention period for request logs (section 9). Which period to publish is open.

The CLI tools (`pnpm ops:block`) and the browser hovercards script still print plain text on purpose, and the development email sender prints the code to the console when `RESEND_API_KEY` is unset.

### Request ids

Delivery and web give every request an id and return it in the `x-request-id` response header. A well-formed incoming `x-request-id` (8 to 64 characters of letters, digits, `.`, `_`, `-`) is kept, so one id can follow a request across Cloudflare, web, and delivery. Otherwise a UUID is generated. In web the `proxy.ts` handler sets it on pages and API routes alike. The id is in the JSON body (`error.request_id` on delivery, `request_id` on web) for 5xx responses only. Client errors (4xx) stay byte for byte identical across requests, because hash lookups must not reveal whether a link exists (issue 59). The id is in every log line for the request and in the Sentry event tag `request_id`, so a user who quotes it from a 5xx body or header can be traced.

### Health and readiness

| App | Liveness | Readiness | Fly check |
| --- | --- | --- | --- |
| delivery | `GET /healthz` returns `ok` | `GET /readyz` runs `SELECT 1`, 503 `not_ready` on failure or after `READY_TIMEOUT_MS` (default 3000) | `/healthz` only, in `fly/delivery.toml` (low-resource mode) |
| web | `GET /` | `GET /api/health` runs `SELECT 1` with the same budget | `/` only, in `fly/web.toml` (low-resource mode) |
| indexer | `GET :8080/healthz` | `GET :8080/readyz`, 503 `stalled` (see below) | `/readyz`, in `fly/indexer.toml` |

Delivery exempts `/healthz` and `/readyz` from the `ORIGIN_SECRET` lock so Fly's checker and outside monitors work. The readiness routes are not Fly checks in low-resource mode (see Low-resource mode); call them by hand or from an uptime monitor. Without `DATABASE_URL` (local dev) readiness answers ok. Neon suspends idle computes, so the first query after idle can be slow: the 3 second budget and the 5 second Fly check timeout leave room for a wake-up, and the first check after a long idle may fail once. Fly marks a machine failing a check as unhealthy and stops routing to it. Do not rely on a restart (not confirmed from the Fly docs for these checks); the alerts below are what tell a human.

**Indexer.** It had no HTTP service. It now runs a small internal HTTP server on port 8080 (`HEALTH_PORT`). `fly/indexer.toml` still has no `[http_service]`, so the port is reachable only by Fly's checker and over private networking. Two signals keep it ready:

- Tap events processed successfully (`lastEventId` is the consumer cursor), and
- a heartbeat: a successful `GET /health` against Tap every `TAP_PROBE_INTERVAL_SECONDS` (default 15), which keeps a quiet but healthy indexer ready.

`/readyz` returns 503 when neither arrived within `INDEXER_STALL_SECONDS` (default 300), or when event handling has been failing without a single success for that long (for example Postgres down while Tap keeps answering). The JSON body shows `lastEventAgeSeconds`, `lastHeartbeatAgeSeconds`, `lastEventId`, and `outboxBuffer`. The cursor lag is the number of events waiting in Tap's outbox, read from `GET /stats/outbox-buffer` (listed in the Tap README). **Unverified:** the README does not show the response shape of that endpoint, so the code takes the first number in the response, and the probe sends the admin password as basic auth the way `@atproto/tap` does. Confirm against staging Tap (`curl -u admin:$TAP_ADMIN_PASSWORD http://blueyvatar-tap.internal:2480/stats/outbox-buffer` from `fly ssh console`) and fix the parser if it reads the wrong field. If the lag gauge stays absent, only the lag gauge is affected; readiness does not depend on it.

### Error tracking

Set `SENTRY_DSN` (a Fly secret) to turn error tracking on. Unset means nothing is sent and nothing is buffered. It accepts any Sentry-compatible DSN (Sentry, GlitchTip, self-hosted). The reporter is a small client in `packages/core` that posts events with the public envelope protocol (<https://develop.sentry.dev/sdk/data-model/envelopes/>) and has no SDK dependency, which keeps the web bundle and the Docker image unchanged. It does not do tracing, sessions, or source map upload. If those are wanted later, swap in `@sentry/node` behind the same `createErrorTracker` interface. **Not tested against a live Sentry project:** tests cover the envelope with a stubbed transport, so send a test error on staging first (for example call a route with a failing dependency) and check it appears.

What is reported: unhandled errors in delivery (`app.onError`), web server errors (`onRequestError` in `apps/web/instrumentation.ts`), the places web logs a failure (`reportError`), indexer event handler failures, Tap channel errors, re-verification failures, Postgres pool errors, and unhandled rejections. Each event carries `app`, `request_id`, a `task` tag, release (`SENTRY_RELEASE`, default `FLY_IMAGE_REF`), and environment (`SENTRY_ENVIRONMENT`, default the Fly app name).

Scrubbing happens before send: header values for `Authorization`, `x-api-key`, `cookie`, and anything with `token`, `secret`, `password`, or `signature` in the name are replaced; query values for `token`, `key`, `sig`, `code` are replaced; emails and `Bearer` values inside messages are masked. The request body is never attached. Events carry no user, IP, or DID.

### Metrics

Chosen: an in-process registry rendered in the Prometheus text format, read by scraping. Reasons: no vendor lock-in, no per-request network cost, and the Sentry metrics API is not part of the Sentry-compatible protocol that other servers implement. The cost is that something must scrape it. Fly's managed Prometheus can scrape `[metrics]` endpoints (<https://fly.io/docs/monitoring/metrics/>), which is not set up here; wiring it is an owner step (add a `[metrics]` section with `port` and `path` to the toml, and a token if needed). Counters reset when a machine restarts, so use `rate()` and `increase()`.

| App | Endpoint | Auth |
| --- | --- | --- |
| delivery | `GET /metrics` | `Authorization: Bearer $METRICS_TOKEN`; 404 when unset |
| web | `GET /api/metrics` | same |
| indexer | `GET :8080/metrics` | none, internal port only |

Delivery series: `delivery_http_requests_total{route,status}` (status class), `delivery_http_request_duration_ms` (histogram by route), `delivery_resolutions_total{route,result}` (avatar and profile, `found` or `miss`), `delivery_blob_cache_hits_total`, `delivery_blob_failures_total{outcome}` (the `getBlob` outcomes `not_found`, `server_error`, `timeout`, `network_error`, `negative_cache`, `invalid_endpoint`), `delivery_transforms_total{format}`, `delivery_transforms_in_flight` (gauge, resize workers running), `delivery_transforms_queued` (gauge, jobs waiting for a slot), `delivery_transforms_shed_total` (jobs answered 503), `delivery_rate_limit_rejections_total`, `delivery_postgres_errors_total`, `delivery_readyz_failures_total`.

Indexer series: `indexer_events_total{type,result}`, `indexer_last_event_age_seconds`, `indexer_last_heartbeat_age_seconds`, `indexer_last_event_id`, `indexer_tap_outbox_buffer` (lag), `indexer_ready`, `indexer_postgres_errors_total`.

Web series: `web_stripe_webhook_total{result}` (`ok`, `failed`, `bad_signature`). Web does not export request metrics; use the Fly proxy metrics for its latency and 5xx rate.

### Alert rules

Thresholds are starting points to tune after a week of real traffic. "Page" means a notification to the on-call owner. Rules marked Fly metrics use the Fly proxy series (`fly_edge_http_responses_count`, `fly_edge_http_response_time_seconds`, see <https://fly.io/docs/monitoring/metrics/>) and need no code. The rest use the series above and need the scraping in the Metrics section, or the equivalent Sentry alert.

| Alert | Condition | Source | Severity |
| --- | --- | --- | --- |
| 5xx rate | 5xx responses above 2 percent of requests for 5 minutes, per app | Fly metrics, or `delivery_http_requests_total{status="5xx"}` over total | page |
| p95 latency | delivery p95 above 1 second for 10 minutes on `/avatar/:hash` and `/u/:id`; above 3 seconds on `/img/...` (resizes) | `delivery_http_request_duration_ms` (`histogram_quantile(0.95, ...)`) | warn |
| Indexer stalled | `indexer_ready == 0` for 5 minutes, or the Fly check `indexer_ready` failing | indexer `/readyz`, Fly check status | page |
| Indexer lag | `indexer_tap_outbox_buffer` above 5000 for 10 minutes, or `indexer_last_event_age_seconds` above 900 while the outbox is above 0 | indexer `/metrics` | page |
| Postgres connection errors | `increase(delivery_postgres_errors_total[5m]) + increase(indexer_postgres_errors_total[5m]) > 0`, or `delivery_readyz_failures_total` rising for 3 checks, or a Sentry issue tagged `task:postgres_pool` | metrics, Sentry | page |
| Stripe webhook failures | any `web_stripe_webhook_total{result="failed"}` in 15 minutes, or a Sentry issue titled `stripe webhook failed` (tag `stripe_event_type`); also watch the endpoint in the Stripe dashboard, which retries for up to three days | metrics, Sentry, Stripe | page |
| getBlob failures | `delivery_blob_failures_total` above 5 percent of `delivery_transforms_total` for 10 minutes | delivery metrics | warn |
| Rate-limit spike | `delivery_rate_limit_rejections_total` rate more than 10 times its weekly median | delivery metrics | info |
| Any new Sentry issue | first seen in production | Sentry | notify channel |

### Service status (outside Fly)

Issue 179. The owner chose to watch BlueyVatar from the Cdaeris uptime dashboard (`CdaerisAgency/uptime`, Gatus, `uptime.cdaeris.com`, internal) instead of a separate status page. Design and open items: `docs/research/status-page-v1.md`.

| Gatus row | Probe | Green means |
| --- | --- | --- |
| `web /api/health` | `GET https://blueyvatar.com/api/health`, body `status` is `ok`, every 4 hours | web serves through Cloudflare and ran `SELECT 1` |
| `delivery /readyz` | `GET https://img.blueyvatar.com/readyz`, body `status` is `ready`, every 4 hours | delivery serves through Cloudflare and its Postgres check passed |
| `delivery /healthz` | `GET https://img.blueyvatar.com/healthz` returns 200, every 4 hours | the delivery process answers |

The rows ship disabled and need `enabled: true` after the first production deploy. They send no secret, because delivery exempts `/healthz` and `/readyz` from the origin lock. At 4 hours this is a slow second opinion from outside Fly. The alert rules above are the fast signal. During an incident, read the rows together: `/healthz` red means the process is down, `/healthz` green with `/readyz` red means the database check failed, and web red with delivery green points at the web app. There is no public status page yet, so tell affected Pro and Business developers by email from `alerts@blueyvatar.com`.

### Owner checklist

1. Create a Sentry (or compatible) project, copy its DSN, and `fly secrets set --app <app> SENTRY_DSN=...` on web, delivery, and indexer (staging: its own DSN). Add it to Infisical as `SENTRY_DSN` and `STAGING_SENTRY_DSN`.
2. Generate a metrics token per app (`openssl rand -hex 32`) and set `METRICS_TOKEN` on delivery and web. Store it in Infisical.
3. Create the alerts in the table in Sentry, Grafana, or Fly's managed Prometheus. Nothing is created automatically.
4. After the first deploy, check `curl https://<delivery host>/readyz`, `curl https://<web host>/api/health`, and `fly ssh console --app blueyvatar-indexer -C "node -e \"fetch('http://localhost:8080/readyz').then(r=>r.text()).then(console.log)\""`, and confirm the `outboxBuffer` value in the indexer response is a number.
5. After the first production deploy, set `enabled: true` on the three BlueyVatar rows in `CdaerisAgency/uptime` `config.yaml` and redeploy that dashboard, and confirm the Trigger.dev watchdog alert exists there (see Service status above).
