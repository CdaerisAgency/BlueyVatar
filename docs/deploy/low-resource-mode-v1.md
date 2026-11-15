# Low-resource mode

Owner decision, November 7, 2026: "because we have no user adoption right now, all services, fly, neon, etc, should be configured for the lowest resource use and uptime acceptable." The configs in `fly/` and this runbook implement it. Raise the numbers in "Scaling up later" when traffic or paid users arrive.

### Fly sizes

| App | VM | Machines | Scale to zero | Why this size |
| --- | --- | --- | --- | --- |
| web | `shared-cpu-1x`, 512 MB | 1, region `iad` only | yes | A local `next start` of the production build used about 178 MB peak resident memory after 60 requests with no database attached (measured November 7, 2026). That leaves too little headroom for a 256 MB VM once Postgres, OAuth, and image uploads are in play. Not measured on Fly. |
| delivery | `shared-cpu-1x`, 512 MB | 1, region `iad` only | yes | Each resize forks a worker process with a 256 MB heap cap (`apps/delivery/src/resize.ts`, `maxOldSpaceMb`) beside the parent, which also holds a 32 MB original cache (`BLOB_CACHE_MB`). Concurrent resizes are capped at 2 (see Resize concurrency cap below). Memory per worker is measured locally, not on Fly. |
| indexer | `shared-cpu-1x`, 256 MB | exactly 1 | no | A Node process with a small Postgres pool (`PG_POOL_MAX`, default 5). Not measured on Fly; the first out-of-memory kill in `fly logs` means move to 512 MB. |
| tap | `shared-cpu-1x`, 512 MB | exactly 1 | no | The Tap README states no memory requirement. It does say the outbox buffers up to 1M pending events in memory and the identity cache defaults to 2,000,000 entries (`TAP_IDENT_CACHE_SIZE`). Treat 512 MB as a starting point and try 256 MB in staging first. **Unconfirmed.** |

Sizes in `fly/*.toml` come from the `[[vm]]` section (<https://docs.fly.io/reference/configuration>). Fly's pricing page lists `shared-cpu-1x` at 256 MB, 512 MB, and 1 GB (<https://docs.fly.io/about/pricing>), so 256 MB is the smallest size we found a price for. The pricing page also says a stopped Machine is not charged for CPU or RAM, only its root file system.

### Scale to zero (web and delivery)

Both apps set `auto_stop_machines = "stop"`, `auto_start_machines = true`, and `min_machines_running = 0`. Fly documents these as follows (<https://docs.fly.io/launch/autostop-autostart>): `auto_stop_machines` accepts `"off"`, `"stop"`, or `"suspend"`; Fly Proxy stops Machines when the app has been idle for several minutes; `min_machines_running` keeps that many Machines running in the primary region and has no effect unless autostop is `"stop"` or `"suspend"`. The proxy runs its check every few minutes, and with a single Machine it stops it when there is no traffic (<https://docs.fly.io/reference/fly-proxy-autostop-autostart.md>). The first request after a stop starts the Machine, so expect a cold start. Fly publishes no latency figure. The same page warns that for a short time after a start, requests can fail until all proxy nodes know the Machine is running. A visitor can therefore see one error right after a long idle.

`"suspend"` is the other documented option. Fly does not say how it differs from `"stop"` in startup speed, so the configs use `"stop"`. **Unconfirmed:** whether `"suspend"` would be faster.

**Health checks.** Fly's docs do not say whether HTTP check requests count as traffic for autostop (the autostop and health check pages are silent on it), so this is **unconfirmed**. To avoid depending on it, each scaled-to-zero app has one liveness check on a 60 second interval, and the Fly checks no longer include the readiness routes (`/readyz` on delivery, `/api/health` on web). Those routes run `SELECT 1`, so a check on them every interval would wake the Neon compute for as long as the machine runs. Use them from a manual call or an uptime monitor with a long interval. If a Machine never stops on its own after a deploy, suspect the Fly check first and try removing it.

The delivery `release_command` still runs the migrations on each deploy, which wakes Neon once per deploy.

### Resize concurrency cap (delivery)

Every cold `/img` variant, `/default` avatar, and QR PNG forks one sharp worker. The local load test (`docs/research/load-test-v1.md`) measured about 65 to 70 MB resident per worker, and an uncapped run reached 37 workers (2.5 GB) at 50 rps and 88 workers (6.3 GB) at 200 rps. On the 512 MB VM that would be an out-of-memory kill, so delivery caps the number of workers at once (`limitedResizer` in `apps/delivery/src/resize.ts`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `IMG_MAX_CONCURRENT` | `2` | Resize workers running at once. |
| `IMG_QUEUE_MAX` | `8` | Jobs allowed to wait for a slot. A request past this is shed at once. |
| `IMG_QUEUE_WAIT_MS` | `3000` | Longest a job waits for a slot before it is shed. |
| `RATE_BATCH_MS` | `1000` | Flush period for the in-memory rate-window and usage counters (see below). `0` writes through on every request. |

The web app reads the same three variables for the server-side upload downscale (issue #203), with its own defaults of `1`, `4`, and `5000`.

Sizing for 512 MB: the Node parent measured 92 to 272 MB resident in the local runs (the 32 MB blob cache included), which leaves about 240 MB. Two workers at 65 to 70 MB is 130 to 140 MB, with the rest as headroom for a larger source image (the worker accepts up to 40 megapixels, which decodes to far more than a 1024 px avatar) and for the OS. Three would fit a typical avatar and not a large one, so the default is 2. Not measured on Fly: if `fly logs` shows no out-of-memory kills under a burst of cold variants, raise it; on a 1 GB VM use 4. A shed request gets `503` with `Retry-After: 2`, `Cache-Control: no-store`, and error code `overloaded`, so Cloudflare does not cache it and the client retries.

Sharp's own settings follow the cap: each worker runs `sharp.concurrency(1)` and `sharp.cache(false)`, so total sharp threads equal the cap and no libvips cache accumulates. On a 1 vCPU shared machine a higher per-worker thread count would only add contention.

**Batched counters.** Rate windows and usage counters are counted in memory and flushed to Postgres every `RATE_BATCH_MS`. The first hit on a key or a new window still writes through. With several machines each one sees the others' counts only at its flush, so a limit can be overshot by up to (machines x requests per interval), and a hard kill loses at most one interval of increments (SIGTERM and SIGINT flush first). Because delivery scales to zero, a one second interval also means Neon is touched at most once a second per active key instead of once per request.

### Indexer and Tap cannot scale to zero

The indexer holds a live connection to Tap, and Tap holds the live firehose connection. Stopping either one stops event intake, so both stay at one always-on machine with no autostop (Fly's default for `auto_stop_machines` is `"off"`). Tap is also tied to one machine by its volume.

What happens if they are down anyway (for example a crash, a deploy, or a manual stop): the Tap README says Tap saves its firehose cursor (every 1 second by default, `TAP_CURSOR_SAVE_INTERVAL`) and resumes from it on restart, which "can mean replaying millions of events", and that "any repos that changed while offline will be detected and resynced automatically" (<https://github.com/bluesky-social/indigo/blob/main/cmd/tap/README.md>). It also says events are delivered at least once, and repos that fell behind resync when their next firehose event arrives. So short outages are caught up from the cursor. The README does not state how long a cursor stays valid at the upstream relay, so a long outage is **unconfirmed**. Do not plan on stopping Tap for days. The tradeoff we accept: roughly two always-on 256 to 512 MB machines instead of zero, because missed or very late profile and image events are worse than the small cost.

### Tap volume

`tap_data` is 1 GB, the default and the smallest whole-gigabyte size `fly volumes create --size` takes (<https://docs.fly.io/flyctl/volumes-create/>; no minimum is documented, and the flag is an integer). The Tap README gives no disk size guidance, so the right size is unknown (**unconfirmed**). This deployment tracks only accounts that have a `com.blueyvatar.profile` record (`TAP_SIGNAL_COLLECTION`), which keeps the database small at launch volumes, but that is our expectation, not a measurement. Fly bills the full provisioned size ($0.15 per GB per month, <https://docs.fly.io/about/pricing>). Volumes can be extended but not shrunk (<https://docs.fly.io/volumes/overview>), so starting small is the safe direction. Watch usage with `fly ssh console --app blueyvatar-tap -C "df -h /data"` and extend before it passes about 70 percent (see "Extend a volume" in <https://docs.fly.io/volumes/volume-manage>).

### Neon

Set both branch computes to the minimum size and the shortest scale-to-zero delay the plan allows. Neon's docs say:

- The smallest size is 0.25 CU, and autoscaling supports 0.25 to 16 CU (<https://neon.com/docs/manage/computes>). Set autoscaling minimum and maximum both to 0.25 CU on production and staging for the lowest resource use, or keep a maximum of 1 CU if you want headroom for a traffic burst.
- Scale to zero defaults to 300 seconds (5 minutes). On the Free plan it is fixed at 5 minutes and cannot be changed or disabled. On the Launch plan it is 5 minutes and can be disabled. On the Scale plan it can be set from 60 seconds to one week. Initial configuration is only supported through the Neon API (`suspend_timeout_seconds`), after which the console control appears (<https://neon.com/docs/guides/scale-to-zero-guide>).
- A suspended compute reactivates "within a few hundred milliseconds" on the next query (<https://neon.com/docs/introduction/scale-to-zero>).

The owner already chose suspend-on-idle for production, and staging suspends after 5 minutes. So: on the Scale plan set 60 seconds on both branches; on Free or Launch leave the 5 minute default. Do not run keepalive pings.

What still touches Neon (these are the only in-app jobs that do):

| Job | Where | Interval | Notes |
| --- | --- | --- | --- |
| Rate window cleanup | delivery (`apps/delivery/src/rate-cleanup.ts`) | daily (was hourly) | Expired rows reset on next use, so cleanup only reclaims space. |
| Log retention purge | delivery (`apps/delivery/src/log-retention.ts`) | 60 seconds after start, then daily | Runs on every wake of a scaled-to-zero machine. If delivery gets no traffic, it does not run, so rows older than the 90 day retention can stay until the next wake. |
| Billing retention purge | indexer (`apps/indexer/src/billing-retention.ts`) | at start, then daily | Already daily. |
| Claim re-verification | indexer (`REVERIFY_INTERVAL_HOURS`) | 24 hours | Already daily. |
| Index writes | indexer | per Tap event | The indexer writes when Tap delivers an event for a tracked account, so Neon wakes on that traffic. Cannot be deferred without losing the live stream. |
| Page polling | web, `/account/domain` (`PollRefresh.tsx`) | 15 seconds while that page is open in a browser | Only while a user watches the page. |
| Fly health checks | all apps | 60 seconds | None of them query Postgres now. |

The indexer also probes Tap's `/health` every `TAP_PROBE_INTERVAL_SECONDS` (15), which does not touch Neon.

### Staging

Staging uses the same configs, so it has the same sizes. Keep it stopped when unused: `fly machine stop <id> --app blueyvatar-<app>-staging` for each app, with the id from `fly machine list --app blueyvatar-<app>-staging`. Delivery and web also stop themselves when idle. Start them again with `fly machine start` before testing, Tap first. Staging Tap on a stopped machine is not receiving events, so start it a while before you test event flow. The staging volume is still billed while stopped. Recreate it at 1 GB (it was created at 10 GB): `fly volumes destroy`, then `fly volumes create tap_data --app blueyvatar-tap-staging --region iad --size 1`.

### Scaling up later

- More memory: `fly scale memory 1024 --app blueyvatar-<app>` for a one-off, or change `memory` in the `[[vm]]` section of `fly/<app>.toml` (a deploy resets manual `fly scale vm` changes to the file, per the configuration reference).
- Always warm web or delivery: set `min_machines_running = 1`, or `auto_stop_machines = "off"`, in `fly/web.toml` or `fly/delivery.toml`, and add the readiness check back (`/readyz`, `/api/health`).
- More machines or regions: `fly scale count 2`, or add regions; keep Tap at one machine.
- Bigger Tap volume: extend it (volumes cannot shrink).
- Neon: raise the autoscaling maximum, disable scale to zero (Launch plan or higher), or raise the minimum CU.
- Rate window cleanup: pass a shorter interval to `scheduleRateWindowCleanup` in `apps/delivery/src/server.ts`.

### Cost

No cost estimate is given here beyond Fly's published list prices: a continuously running `shared-cpu-1x` is $3.69 per month at 512 MB and $2.19 per month at 256 MB, and a 1 GB volume is $0.15 per month (<https://docs.fly.io/about/pricing>). Stopped Machines pay only for their root file system. Neon plan prices are not quoted here.
