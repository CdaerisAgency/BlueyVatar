# Live Tap integration test (v1)

Issue #42. This test runs the indexer against a real Tap and asserts the Postgres rows. Tap is in beta, so it is the check to run before bumping the pinned image in `fly/tap.toml`.

It is opt-in. A default `pnpm -r test`, the CI `check` job, and the CI `docker` job never start it: the test file skips with a one-line message unless you ask for it.

## What it covers

| Acceptance item | Where |
| --- | --- |
| Tap in a container with the signal collection and the collection filters | `test-support/tap-live-stack.ts` starts the image pinned in `fly/tap.toml` with `TAP_SIGNAL_COLLECTION` and `TAP_COLLECTION_FILTERS` read from that file, so the test cannot drift from production. The issue says four filters. Production now filters seven collections (the four BlueyVatar and Bluesky ones plus `app.bsky.actor.link` and both Tangled profile NSIDs), so the test uses all seven. |
| Create, update, delete image, profile, claim records and confirm rows | First test in `apps/indexer/src/tap-live.test.ts`. Rows are read back from Postgres. |
| Account status events update `repos` | Third test: deactivates the account, waits for `repos.active = false` and `status = 'deactivated'`, reactivates it, waits for `active = true`. |
| Events acked only after the handler succeeds | Second test: one claim upsert is made to throw. The test checks that the event was not acked and the row is absent, that Tap redelivers it after its retry timeout, and that the ack follows the successful second run. Every other delivery in the run must show handler success before ack. |
| How to run locally | Below. |

It also asserts that the `cid` on every Tap record event equals the record CID the PDS returned (the question in the #42 comment about profile links, issue #101), for all seven collections, and that a stored link resolves through `resolveProfileLinks` until the link record is updated.

The test drives the same wiring as production. `src/wiring.ts` (`createIndexer`) holds the Tap-event-to-write mapping, `src/index.ts` and the test both use it, and writes go through `PgIndexWrites`.

## How it works

1. `apps/indexer/live-stack` (its own `package.json`, not a pnpm workspace member) starts an in-memory PLC directory and a PDS from `@atproto/dev-env` and creates one account. Nothing is sent to the network and no real account is used.
2. The test starts Tap with `TAP_PLC_URL` pointing at that PLC directory and `TAP_RELAY_URL` pointing at that PDS (a PDS serves `com.atproto.sync.subscribeRepos` itself, so no relay is needed). It uses `TAP_NO_REPLAY=true`, a random admin password, and `TAP_RETRY_TIMEOUT=3s`.
3. The test signs in, writes records over XRPC, calls `tap.addRepos`, and consumes events through `@atproto/tap`.
4. Postgres: a throwaway schema in `TEST_DATABASE_URL` with all migrations applied, dropped at the end.

The Tap container uses `--network host`, because the DID document served by the local PLC directory names the PDS as `http://localhost:<port>` and Tap must reach it at that address.

## Run it locally

Requirements: Linux, macOS, or WSL2 with Node 22 or newer, Docker, and a Postgres where the test can create and drop a schema (the same `TEST_DATABASE_URL` the other Postgres tests use).

```sh
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/blueyvatar_test
pnpm tap:live:local
```

`tools/tap-live-local.sh` runs `npm ci` in `apps/indexer/live-stack`, builds core, sets `LIVE_TAP_TEST=1`, and runs `pnpm --filter @blueyvatar/indexer test:tap-live`. The first run pulls the Tap image. Each wait times out after 90 seconds (`TAP_LIVE_TIMEOUT_MS`), and a timeout message lists the events seen and the tail of Tap's logs.

Skip rules:

- Without `LIVE_TAP_TEST=1` (and without the external variables below), the test skips.
- With `LIVE_TAP_TEST=1` but no Docker daemon and no `TAP_LIVE_TAP_BIN`, it skips and says why.
- With `LIVE_TAP_TEST=1`, Docker present, and `TEST_DATABASE_URL` missing, it fails with a message. The flag means you asked for the run.

Constraints:

- Windows without WSL2 is unsupported. The dev-env PDS names directories after DIDs, and `did:plc:...` is not a valid Windows directory name.
- Docker Desktop on macOS or Windows needs host networking enabled (Docker Desktop 4.34 or newer, Settings, Resources, Network) for `--network host` to reach the host's loopback. This is unconfirmed here; Linux and GitHub Actions work natively.

### Without Docker

Set `TAP_LIVE_TAP_BIN` to a Tap binary built from the same indigo tag as the pinned image (`go install github.com/bluesky-social/indigo/cmd/tap@tap-v0.1.10`, then the path to the binary). The binary uses SQLite by default, which needs a cgo build. If your binary has no SQLite driver, set `TAP_LIVE_TAP_DATABASE_URL` to a Postgres URL for Tap's own database (a separate database from the one in `TEST_DATABASE_URL`, created fresh for each run).

### Against an existing Tap and account (external mode)

For a staging Tap and a test account you own, skip `LIVE_TAP_TEST` and set `TAP_LIVE_URL`, `TAP_LIVE_IDENTIFIER`, `TAP_LIVE_APP_PASSWORD`, and `TEST_DATABASE_URL`, plus optionally `TAP_LIVE_ADMIN_PASSWORD`, `TAP_LIVE_PDS_URL` (default `https://bsky.social`), and `TAP_LIVE_CHECK_STATUS=1` for the status test. Then `pnpm tap:live`. Details are in the "Live Tap test" section of `docs/deploy.md`. Stop any other consumer of that Tap first, since a channel hands each event to one consumer.

## GitHub Actions

`.github/workflows/live-tap.yml` runs the managed test on demand (Actions, Live Tap, Run workflow). It uses a Postgres service container and the same `runs-on` expression as CI. It is not triggered by pushes or pull requests, so the `check` and `docker` jobs are unchanged. There is no schedule, because the image and the PDS package are both pinned and a scheduled run would only repeat the same result; add one if you want a regular smoke test.

## What was verified, and what was not

Verified (2026-11-07, Windows host, no Docker):

- Tap built from `indigo` tag `tap-v0.1.10` (the tag of the pinned image) as a native binary, with a Postgres backend, against the local PDS and PLC directory and a real Postgres 18. All three tests passed on two consecutive runs. This covers the event-to-row path for all seven collections, the CID check, the redelivery of an unacked event, and the `repos` status updates.
- The default run (no flag) skips cleanly.

Not verified:

- The Docker path itself (`docker run` of the pinned image with host networking and SQLite on `/data`). No Docker daemon was available. The command is built in `test-support/tap-live-stack.ts` and the GitHub Actions workflow has not run yet.
- The SQLite backend. The native binary on that host has no cgo, so the run used Postgres for Tap's own storage.
- Running the PDS natively on Windows needed a local patch to `@atproto/pds` (replacing `:` in directory names). The patch is not committed. Use Linux, macOS, or WSL2.

## Unconfirmed against vendor docs

Checked against the Tap README (`cmd/tap/README.md` in the indigo repo, tag `tap-v0.1.10`):

- Confirmed in the README: the env var names used here, `TAP_ADMIN_PASSWORD` as HTTP Basic auth with user `admin`, `POST /repos/add`, at-least-once delivery, per-repo ordering, and that an event is acked by the client after processing.
- The README gives two defaults for the retry of unacked events: `TAP_RETRY_TIMEOUT` is listed as `60s`, and the ordering section says events time out "default 10s". Unconfirmed which one applies. The test sets `TAP_RETRY_TIMEOUT=3s` explicitly and in external mode waits up to `TAP_LIVE_TIMEOUT_MS`.
- The README does not say that `TAP_RELAY_URL` can point at a PDS instead of a relay. It worked with 0.1.10 in the run above, so it is observed, not documented.
- The README does not describe the first identity event. In the run above, Tap sent an `identity` event with `active` for the repo before its records, which is what fills the first `repos` row.
- The README does not say whether a redelivered event keeps its `id`. The test matches the redelivery by DID, collection, record key, and CID, not by `id`.
- The README says `/health` returns `{"status":"ok"}` and that the admin password is required for all requests; `fly/tap.toml` records a 401 without it in staging, and the test sends the password.
