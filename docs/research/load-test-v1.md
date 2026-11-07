# Load test results, version 1

Issue: #149 (part of #9). Revision 2 (issue #198) adds the section "Re-run after the resize cap and counter batching (LOCAL)" below; the sections before it are the original run and are kept for comparison. Status: **local numbers only. No staging deployment exists yet, so nothing below describes Fly or Neon.** Every figure in this file is labeled LOCAL and must not be used to size production until the staging run in the last section replaces it.

## What was measured

The harness lives in `tools/loadtest`. For the local run it drives the real delivery app (`apps/delivery/dist`) with the real Postgres stores, the real fixed-window rate limiter, the real usage meter, and the real sandboxed sharp resizer, against a local Postgres 16 with the migrations applied.

One part is simulated, on purpose: the atproto network. A local run must not reach plc.directory or any PDS, so `tools/loadtest/src/local-server.mjs` swaps the resolver for one backed by the seeded `repos` and `images` rows. A resolver cache miss costs a database read plus a 25 ms sleep (`LT_COLD_MS`), and a PDS blob fetch costs 40 ms (`LT_BLOB_MS`) and returns a synthetic 1024 by 1024 JPEG. Those two delays are assumptions, so the cold-path latencies (`u-cold`, `img-cold`) carry that offset and nothing else about the network.

## Local environment (LOCAL)

- Machine: 4 vCPU Intel Xeon 2.3 GHz, 16 GB RAM, Linux 6.18, Node 22.23, Postgres 16.15 on the same machine (shared_buffers 128 MB, max_connections 100, default settings).
- Delivery pool: `PG_POOL_MAX=10`, the production default. One delivery process, no CDN in front.
- Seed: 20,000 synthetic identities (linked email hashes, handles, one avatar image each) and 200 business keys.
- The load generator, the server, and Postgres share the same 4 cores, and the machine was shared with other jobs. The one-minute load average before each step ranged from 1.8 to 17 (stored per step in the raw results). Read the tail latencies as noisy. Throughput, CPU, and memory figures are more stable than p95 and p99.
- Duration: 20 seconds per step, open loop (latency is measured from each request's scheduled send time), one step per target rate of 10, 50, and 200 requests per second.

## Results at 10, 50, and 200 rps (LOCAL)

| Scenario | Target rps | Sent | Shed | Error % | p50 ms | p95 ms | p99 ms | Server cores avg/max | Server RSS MB | Resize children RSS MB (count) | Postgres cores avg/max | PG conns max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| avatar-anon | 10 | 200 | 0 | 0 | 8.9 | 69.1 | 182.6 | 0/0 | 91.6 | 0 (0) | 0/0.1 | 2 |
| avatar-anon | 50 | 1000 | 0 | 0 | 2.8 | 5.7 | 41.5 | 0.1/0.1 | 94.8 | 0 (0) | 0.1/0.1 | 11 |
| avatar-anon | 200 | 4000 | 0 | 0 | 1.7 | 3.1 | 6.1 | 0.1/0.2 | 99.8 | 0 (0) | 0.2/0.2 | 7 |
| avatar-keyed-hot | 10 | 200 | 0 | 0 | 5.4 | 7.4 | 8.2 | 0/0.1 | 100 | 0 (0) | 0/0.1 | 4 |
| avatar-keyed-hot | 50 | 1000 | 0 | 0 | 4.2 | 12.9 | 22.2 | 0.1/0.1 | 97.6 | 0 (0) | 0.1/0.1 | 6 |
| avatar-keyed-hot | 200 | 4000 | 0 | 0 | 18.8 | 91.4 | 169.1 | 0.2/0.2 | 107.9 | 0 (0) | 0.4/0.5 | 11 |
| avatar-keyed-spread | 10 | 200 | 0 | 0 | 5.7 | 14.3 | 17.6 | 0/0 | 107.9 | 0 (0) | 0/0.2 | 11 |
| avatar-keyed-spread | 50 | 1000 | 0 | 0 | 3.2 | 5.9 | 8.7 | 0.1/0.1 | 107.9 | 0 (0) | 0.1/0.1 | 3 |
| avatar-keyed-spread | 200 | 4000 | 0 | 0 | 3.8 | 13.9 | 22.6 | 0.2/0.3 | 121.1 | 0 (0) | 0.3/0.4 | 11 |
| u-warm | 10 | 200 | 0 | 0 | 3.1 | 8.4 | 13.2 | 0/0 | 121.1 | 0 (0) | 0/0 | 11 |
| u-warm | 50 | 1000 | 0 | 0 | 1.7 | 3.6 | 6.5 | 0/0.1 | 121.1 | 0 (0) | 0/0 | 3 |
| u-warm | 200 | 4000 | 0 | 0 | 2.1 | 7.6 | 13.1 | 0.1/0.2 | 121.1 | 0 (0) | 0.1/0.2 | 9 |
| u-cold | 10 | 200 | 0 | 0 | 29.1 | 36.2 | 48 | 0/0 | 121.1 | 0 (0) | 0/0.2 | 7 |
| u-cold | 50 | 1000 | 0 | 0 | 26.5 | 27.7 | 29.6 | 0/0 | 121.1 | 0 (0) | 0/0 | 4 |
| u-cold | 200 | 4000 | 0 | 0 | 26.3 | 28 | 30.5 | 0.1/0.1 | 123.6 | 0 (0) | 0.1/0.2 | 9 |
| img-cold | 10 | 200 | 0 | 0 | 156.8 | 185.2 | 198.3 | 1.6/1.8 | 146.3 | 64.7 (1) | 0/0.1 | 4 |
| img-cold | 50 | 501 | 499 | 0 | 4214.3 | 6390.1 | 8042.3 | 3.6/3.8 | 231.8 | 2469.4 (37) | 0/0 | 11 |
| img-cold | 200 | 429 | 3571 | 0 | 4942.2 | 5801.2 | 7509.9 | 3.6/4.1 | 271.7 | 6288.5 (88) | 0/0.1 | 11 |
| profile | 10 | 200 | 0 | 0 | 4.7 | 7.6 | 10.2 | 0/0 | 243.1 | 0 (0) | 0/0 | 11 |
| profile | 50 | 1000 | 0 | 0 | 3.2 | 7.9 | 13.6 | 0.1/0.1 | 236 | 0 (0) | 0.1/0.1 | 3 |
| profile | 200 | 4000 | 0 | 0 | 2.2 | 6.3 | 10.6 | 0.2/0.2 | 236.9 | 0 (0) | 0.2/0.2 | 6 |

Notes on the columns. Shed is requests the generator did not send because 100 were already in flight (applied to `img-cold` only, to protect the test machine). Error % covers every response that was not 2xx, 3xx, or 429, among requests sent. Server cores counts the delivery process and the resize children it reaped. Postgres cores is the CPU of backends alive across each one-second sample, so it is a floor.

### What the numbers say

1. **Redirect and JSON routes are cheap at the origin.** `/avatar`, `/u`, and `/profile` held 200 rps with no errors while the delivery process used about 0.1 to 0.3 cores and Postgres about 0.1 to 0.5 cores (LOCAL). That is roughly 1 to 1.5 ms of delivery CPU per resolution.
2. **A warm resolver cache is worth about 25 ms.** `u-cold` p50 sits at 26 to 29 ms against 2 to 3 ms for `u-warm`, which is the simulated cache-miss delay. On staging this will be the real PLC and PDS cost, so expect it to be larger.
3. **A single hot key costs more than many keys at 200 rps.** `avatar-keyed-hot` p95 was 91 ms against 14 ms for `avatar-keyed-spread` at 200 rps in the final run. Earlier runs on a busier machine showed the same direction (p95 above one second once). It is the rate-window row plus the usage-counter row for one license being updated by every request, and it matches the micro-benchmark below.
4. **`/img` with a cold variant cache is where capacity ends, and memory is the first limit.** At 10 rps it was fine (p50 157 ms, p99 198 ms, 1.6 cores, one child at a time). At 50 rps the machine was out of CPU (3.6 to 3.8 of 4 cores) and latency went to seconds. The server forks one sharp child per request with no concurrency cap, so children piled up: 37 children and 2.5 GB at 50 rps, 88 children and 6.3 GB at 200 rps. Production delivery runs `shared-cpu-1x` with 1 GB (`fly/delivery.toml`), so on that size roughly a dozen concurrent resizes would be enough to run it out of memory. Each child here is about 65 to 70 MB. CPU per transform was about 150 to 160 ms at 10 rps. In production the CDN absorbs repeats, so the origin only sees variant misses, but a burst of distinct variants (a new user's ladder being warmed, or a crawler) has no brake today.

## Re-run after the resize cap and counter batching (LOCAL)

Issue #198 (part of #9). Same harness, same machine class, same seed (20,000 identities, 200 keys), 20 seconds per step at 10, 50, and 200 rps, counters truncated and the server restarted before the run. **LOCAL numbers; nothing here describes Fly or Neon, and the 512 MB VM was not simulated.** The machine was quiet this time (load average 0.3 before the run), so these tail latencies are cleaner than the first run's and not directly comparable to it.

What changed in the server under test (`tools/loadtest/src/local-server.mjs` now wires the same pieces as `apps/delivery/src/server.ts`):

- Concurrent resizes capped at `IMG_MAX_CONCURRENT=2` (sized for the 512 MB VM in `fly/delivery.toml`, see docs/deploy.md "Resize concurrency cap"), queue of 8, 3 second wait, then `503` with `Retry-After: 2`.
- Rate windows and usage counters counted in memory and flushed every 1000 ms (`RATE_BATCH_MS`).
- The generator now reports `503` separately from errors (the "503 from origin" column), because shedding is intended behavior.

### Results at 10, 50, and 200 rps (LOCAL, after the fix)

| Scenario | Target rps | Sent | Shed by generator | 503 from origin | Error % | p50 ms | p95 ms | p99 ms | Server cores avg/max | Server RSS MB | Resize children RSS MB (count) | Postgres cores avg/max | PG conns max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| avatar-anon | 10 | 200 | 0 | 0 | 0 | 4.4 | 7.3 | 10.1 | 0/0 | 102.4 | 0 (0) | 0/0 | 2 |
| avatar-anon | 50 | 1000 | 0 | 0 | 0 | 2.7 | 4.5 | 7 | 0.1/0.1 | 104.7 | 0 (0) | 0.1/0.1 | 2 |
| avatar-anon | 200 | 4000 | 0 | 0 | 0 | 2 | 3.5 | 6.5 | 0.2/0.2 | 108.1 | 0 (0) | 0.2/0.2 | 7 |
| avatar-keyed-hot | 10 | 200 | 0 | 0 | 0 | 3.4 | 4.9 | 6.5 | 0/0 | 110.2 | 0 (0) | 0/0 | 7 |
| avatar-keyed-hot | 50 | 1000 | 0 | 0 | 0 | 1.7 | 2.8 | 5 | 0/0.1 | 110.9 | 0 (0) | 0/0.1 | 4 |
| avatar-keyed-hot | 200 | 4000 | 0 | 0 | 0 | 0.9 | 2.2 | 2.8 | 0.1/0.1 | 110.9 | 0 (0) | 0.1/0.1 | 3 |
| avatar-keyed-spread | 10 | 200 | 0 | 0 | 0 | 3.8 | 6 | 10.5 | 0/0 | 111 | 0 (0) | 0/0 | 11 |
| avatar-keyed-spread | 50 | 1000 | 0 | 0 | 0 | 1.7 | 4 | 9.9 | 0.1/0.1 | 103.5 | 0 (0) | 0.1/0.1 | 11 |
| avatar-keyed-spread | 200 | 4000 | 0 | 0 | 0 | 1.2 | 2.5 | 14.6 | 0.1/0.1 | 111.9 | 0 (0) | 0.2/0.2 | 11 |
| u-warm | 10 | 200 | 0 | 0 | 0 | 2.8 | 5.1 | 5.8 | 0/0 | 111.9 | 0 (0) | 0/0 | 11 |
| u-warm | 50 | 1000 | 0 | 0 | 0 | 2.3 | 4.1 | 6.1 | 0/0.1 | 111.9 | 0 (0) | 0/0 | 3 |
| u-warm | 200 | 4000 | 0 | 0 | 0 | 1.5 | 2.8 | 5.8 | 0.1/0.2 | 112.9 | 0 (0) | 0.1/0.2 | 11 |
| u-cold | 10 | 200 | 0 | 0 | 0 | 28.6 | 31.1 | 33.9 | 0/0 | 112.9 | 0 (0) | 0/0 | 11 |
| u-cold | 50 | 1000 | 0 | 0 | 0 | 27 | 28.7 | 30.2 | 0/0.1 | 103.9 | 0 (0) | 0/0.1 | 2 |
| u-cold | 200 | 4000 | 0 | 0 | 0 | 26.4 | 28.1 | 31.8 | 0.1/0.2 | 114.6 | 0 (0) | 0.1/0.2 | 11 |
| img-cold | 10 | 200 | 0 | 0 | 0 | 157.6 | 181.8 | 194.4 | 1.7/1.9 | 139.3 | 60.6 (1) | 0/0 | 11 |
| img-cold | 50 | 1000 | 0 | 693 | 0 | 53.3 | 766.1 | 797.2 | 2.6/2.7 | 147.8 | 147.7 (3) | 0/0.1 | 11 |
| img-cold | 200 | 4000 | 0 | 3677 | 0 | 70.7 | 666.9 | 800.5 | 2.6/2.7 | 153.4 | 152.8 (3) | 0.1/0.1 | 11 |
| profile | 10 | 200 | 0 | 0 | 0 | 3.5 | 5.4 | 7.6 | 0/0 | 145 | 0 (0) | 0/0 | 11 |
| profile | 50 | 1000 | 0 | 0 | 0 | 2.3 | 3.4 | 5 | 0.1/0.1 | 146.5 | 0 (0) | 0/0.1 | 3 |
| profile | 200 | 4000 | 0 | 0 | 0 | 2 | 3.7 | 5.5 | 0.2/0.2 | 147.8 | 0 (0) | 0.2/0.2 | 5 |

Notes: "Shed by generator" is the generator's own 100-in-flight guard and was 0 everywhere, because the origin now answers excess work with a fast 503 instead of letting it pile up. Error % excludes 2xx, 3xx, 429, and 503; it was 0 in every step. The children count peaks at 3 with a cap of 2 because the sampler can catch a finished worker that has replied but not yet exited while its successor has already forked.

### Before and after (LOCAL)

| Check | Before (first run) | After (cap 2, batching 1 s) |
|---|---|---|
| `/img` cold, 50 rps: resize children at peak | 37 children, 2,469 MB | 3 children, 148 MB |
| `/img` cold, 200 rps: resize children at peak | 88 children, 6,289 MB | 3 children, 153 MB |
| `/img` cold, 200 rps: server RSS | 272 MB | 153 MB |
| `/img` cold, 50 rps: p50 / p95 | 4,214 / 6,390 ms | 53 / 766 ms (requests that were served; 693 of 1,000 got a 503) |
| `/img` cold, 200 rps: served / shed | 429 sent, 3,571 shed by the generator, p50 4,942 ms | 323 served, 3,677 answered 503, p50 71 ms |
| `/img` cold, 10 rps (under the cap) | p50 157 ms, p99 198 ms | p50 158 ms, p99 194 ms, no 503 |
| `avatar-keyed-hot`, 200 rps: p95 / p99 | 91.4 / 169.1 ms | 2.2 / 2.8 ms |
| `avatar-keyed-hot`, 200 rps: Postgres cores avg | 0.4 | 0.1 |
| `avatar-keyed-spread`, 200 rps: p95 | 13.9 ms | 2.5 ms |

How to read it:

1. **Memory is bounded.** With the cap, resize memory stays near 150 MB at any offered rate, against 6.3 GB uncapped. That is about 50 MB per child, below the 65 to 70 MB seen before, because a worker's peak RSS depends on how many run in parallel and on the 1024 px source here. Plan on 65 to 70 MB per worker for sizing and treat the lower number as local. Throughput on `/img` cold is about 15 served per second at cap 2 (307 and 323 served in 20 seconds), which is the machine's cap-limited transform rate, so a burst past that is shed rather than queued without bound.
2. **The 503s are fast.** A shed request costs the origin almost nothing, so served-request latency in the overloaded steps stays under one second (p95 667 to 766 ms, which is roughly a full queue of 8 at about 65 ms per slot) instead of climbing to 6 seconds.
3. **The hot-license gap is gone locally.** One license at 200 rps went from p95 91 ms to 2.2 ms, with Postgres CPU down from 0.4 to 0.1 cores, because the per-request rate-window and usage upserts became one flush per second. The other routes were unchanged within noise (the first run was on a busier machine, so do not read the small differences as gains). `bench-rate.mjs` measures `PgRateLimiter` and `PgUsageMeter` directly and was not re-run, since neither store's single-write cost changed; its numbers above are now the cost of one flush, not one request.
4. **Still unmeasured:** behavior on a real 512 MB Fly VM (the local server process was not memory limited), the Neon commit latency that sets the flush cost, and several machines flushing the same hot key. The accuracy tradeoff for several machines is described in docs/deploy.md.

## Rate-window and usage upsert cost (LOCAL)

Measured with `PgRateLimiter` and `PgUsageMeter` directly (`tools/loadtest/src/bench-rate.mjs`), 20,000 operations per row, pool of 10 connections, no HTTP:

| Case | Concurrency | Ops/s | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|---|
| rate upsert, distinct bucket per call | 1 | 2494 | 0.34 | 0.67 | 1.23 |
| rate upsert, distinct bucket per call | 10 | 8772 | 0.98 | 2.18 | 4 |
| rate upsert, distinct bucket per call | 50 | 8977 | 5.17 | 8.46 | 12.04 |
| rate upsert, one hot bucket | 1 | 2568 | 0.34 | 0.61 | 1.16 |
| rate upsert, one hot bucket | 10 | 3290 | 1.5 | 10.43 | 17.24 |
| rate upsert, one hot bucket | 50 | 3330 | 13.56 | 23.49 | 31.99 |
| usage upsert, one hot license | 1 | 3339 | 0.27 | 0.44 | 0.63 |
| usage upsert, one hot license | 10 | 4338 | 0.73 | 8.87 | 15.31 |
| usage upsert, one hot license | 50 | 4259 | 10.14 | 19.88 | 31.97 |
| rate + usage on one hot license (keyed request) | 1 | 1719 | 0.52 | 0.92 | 1.33 |
| rate + usage on one hot license (keyed request) | 10 | 3018 | 2.72 | 7.37 | 11.22 |
| rate + usage on one hot license (keyed request) | 50 | 3024 | 15.72 | 23.03 | 28.37 |

Reading it:

- A rate-window upsert on a distinct bucket costs about 0.34 ms at concurrency 1 and tops out near 9,000 per second through a 10-connection pool.
- All callers sharing one bucket serialize on one row lock. The ceiling falls to about 3,300 per second, and p99 at concurrency 50 is 32 ms against 12 ms for distinct buckets.
- A keyed request does two writes on the same license (rate window and monthly usage counter). The hot-license ceiling for the pair is about 3,000 keyed requests per second per license. At concurrency 1 it is 1,700 per second.
- Anonymous traffic is spread over client IPs behind Cloudflare, so it behaves like the distinct-bucket row. One big customer behaves like the hot-license row.

### Where rate-window writes dominate

In the HTTP run, Postgres CPU stayed near 0.2 to 0.5 cores at 200 rps, and the per-request database work (visibility, repo status, key lookup, rate upsert, usage upsert) was small next to the redirect itself. Writes become the limiter for one license at roughly 3,000 requests per second on this machine, and for the whole database at roughly 9,000 rate-window upserts per second through a 10-connection pool. Neither is near the 200 rps tested here. The point to re-measure on Neon is the hot-license ceiling, because Neon commit latency is higher than local disk, and it directly sets that number.

Proposed fixes if staging confirms it (a follow-up issue is filed with these numbers): an in-memory first tier that counts per license and flushes batched increments every second or so, and batching usage-counter increments the same way. Exact limits inside a window are already approximate across machines, so the accuracy loss is small. The image-resize memory finding is separate and more urgent: cap concurrent resize children (a small queue or a pool of long-lived workers) before any traffic reaches `/img` at volume. Both fixes shipped in #198; see the re-run section above.

## Cost note (LOCAL inputs, formula for staging)

The inputs that matter, from this run:

| Item | LOCAL figure |
|---|---|
| Delivery CPU per redirect resolution | about 1 to 1.5 ms (0.2 cores at 200 rps) |
| Resolutions per delivery core-hour, if CPU were the only limit | about 2.5 to 3.5 million (extrapolated, not measured at saturation) |
| Postgres CPU per resolution | about 1 to 2 ms |
| Delivery CPU per cold `/img` transform | about 150 to 160 ms, so about 6 to 7 per core-second |
| Resize memory per concurrent transform | about 65 to 70 MB |

To turn that into resolutions per dollar after the staging run: take measured resolutions per second at the knee, divide by the hourly price of the Fly machine plus the Neon compute (CU-hours at the observed average CU) for the same hour. Prices are not entered here because they were not verified for this file; use the current Fly and Neon price pages. The overage-rate decision (spec section 12) should use the staging per-miss cost, and should treat `/img` transforms as a separate, far costlier line than redirects: at these figures one cold transform costs about as much CPU as 100 or more redirect resolutions.

## Exact commands (LOCAL)

Prerequisites: Node 22, pnpm, a local Postgres reachable as `postgres://postgres@localhost:5432`.

```bash
pnpm install && pnpm --filter "./packages/*" build && pnpm --filter @blueyvatar/delivery build
psql -h localhost -U postgres -c "CREATE DATABASE bv_loadtest"
export DATABASE_URL=postgres://postgres@localhost:5432/bv_loadtest
pnpm db:migrate
cd tools/loadtest
node src/seed.mjs --count 20000 --keys 200 --out /tmp/lt/targets.json
node src/local-server.mjs &              # prints its pid, listens on 127.0.0.1:3101
node src/run.mjs --base http://127.0.0.1:3101 --targets /tmp/lt/targets.json \
  --scenario all --rps 10,50,200 --duration 20 \
  --pid <server pid> --pg-url "$DATABASE_URL" --out /tmp/lt/results.json
node src/bench-rate.mjs --concurrency 1,10,50 --ops 20000
node src/seed.mjs --clean                # remove the synthetic rows
```

Truncate `rate_windows`, `usage_counters`, and `service_usage_counters` and restart the server between full runs, so the resolver cache and counters start empty. Scenario names: avatar-anon, avatar-keyed-hot, avatar-keyed-spread, u-warm, u-cold, img-cold, profile.

## Running it against staging after deploy

Staging is the Fly app `blueyvatar-delivery-staging` on the Neon `staging` branch (docs/deploy.md). The generator refuses any host that is not loopback or a staging name (a host label of `staging`), and the seed script refuses a database host that does not name staging. `--i-know` overrides both and must not be used for production.

1. Seed the staging branch. Use the direct (unpooled) Neon connection string:
   `DATABASE_URL=<staging direct url> node src/seed.mjs --count 20000 --keys 200 --out targets.json`
   The rows are synthetic (DIDs `did:plc:zzlt...`, emails `@loadtest.invalid`, keys `bvk_lt_...`). Remove them afterward with `--clean`. The seeded API keys are real keys on staging, so keep `targets.json` private and clean up.
2. Synthetic DIDs do not exist on plc.directory, so the real resolver cannot resolve them. Pick one of: (a) run the staging app with a fixture resolver for the load-test window, (b) point a few seeded rows at one or two real test accounts the owner controls (replace `did` and `cid` in `targets.json` and the `repos` and `images` rows), or (c) accept that the cold-resolution scenarios measure the miss path. Record which one was used.
3. Run from a machine near `iad`, not from a laptop, and write down its size. The generator does not need Postgres or `/proc` access for a remote target:
   `IMG_SIGNING_SECRET=<staging secret> ORIGIN_SECRET=<staging origin secret> node src/run.mjs --base https://blueyvatar-delivery-staging.fly.dev --targets targets.json --scenario all --rps 10,50,200 --duration 60 --spoof-ip`
   `IMG_SIGNING_SECRET` signs the `/img` paths. `ORIGIN_SECRET` is sent as `x-origin-auth` when the origin lock is on. `--spoof-ip` sends a random `cf-connecting-ip` per request so anonymous traffic spreads over rate buckets, which only works when staging has `TRUST_CLOUDFLARE=true` (it is set in `fly/delivery.toml`). Without it all anonymous requests share one bucket and hit the 100 per day limit.
4. Collect what the harness cannot see from the Fly and Neon dashboards for the same window: Fly machine CPU and memory (and OOM kills, which matter for `/img`), Neon compute CU, connections, and CPU, and `pg_stat_statements` for the rate-window and usage upserts if enabled. Re-run `bench-rate.mjs` with the staging direct URL for the real hot-license ceiling.
5. Replace the LOCAL tables above with a staging section, keep the local section for comparison, and close #149 once the cost note has staging prices and the knee is known. Do not run against production.

## Limits of this run

- Single local run per step, shared machine, 20 seconds each. Tail latencies are noisy; repeat on a quiet machine before quoting p99.
- Delivery CPU at saturation was not measured for the redirect routes (the generator and server shared 4 cores and never saturated at 200 rps), so resolutions per core-hour are extrapolated.
- Postgres CPU is sampled from /proc for backends alive in both samples, so it undercounts short-lived connections.
- The Cloudflare layer, TLS, and network latency are absent from every local figure.
