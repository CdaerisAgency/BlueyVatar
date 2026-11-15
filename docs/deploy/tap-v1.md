# Tap

Tap is a separate app that the indexer connects to (`TAP_URL`).

- Env names come from Tap's README: <https://github.com/bluesky-social/indigo/blob/main/cmd/tap/README.md>. `fly/tap.toml` sets `TAP_BIND`, `TAP_SIGNAL_COLLECTION` (`com.blueyvatar.profile`), `TAP_COLLECTION_FILTERS` (the seven collections, comma separated: `com.blueyvatar.image,com.blueyvatar.profile,com.blueyvatar.claim,app.bsky.actor.profile,app.bsky.actor.link,org.tangled.actor.profile,sh.tangled.actor.profile`), `TAP_LOG_LEVEL`, and `TAP_DATABASE_URL`. The secret `TAP_ADMIN_PASSWORD` is set with `fly secrets set`. Clients use Basic auth with user `admin`.
- **Pin the image.** `fly/tap.toml` pins `ghcr.io/bluesky-social/indigo/tap` to tag `0.1.10` and digest `sha256:5e20bfe416d29fcd215ed8bf99f10b2ab825a6de4e5599846dd33967ade2abeb`, the highest semver tag in the registry on November 4, 2026 (tag list read anonymously from the registry API). Upgrade by changing the pin in staging, watching for a clean backfill, then promoting.
- **Storage.** The volume `tap_data` mounts at `/data`, so Tap runs as one machine. The README default is `sqlite://./tap.db` and does not say where that lands in the container, so the config sets `sqlite:///data/tap.db`. Confirmed in staging on November 4, 2026: Tap creates `/data/tap.db` (plus `-shm` and `-wal` files) on the `tap_data` volume. The README says `TAP_DATABASE_URL` also accepts a PostgreSQL connection string but gives no example. A Neon database for Tap is an option to test in staging.
- **Private access.** `fly/tap.toml` has no `http_service` and no `services`, so Tap has no public address (<https://docs.fly.io/reference/configuration>). Do not allocate IPs for it. The indexer reaches it over Fly private networking at `http://blueyvatar-tap.internal:2480` (`<app>.internal` resolves to the app's 6PN addresses, <https://docs.fly.io/networking/private-networking>). Flycast (`<app>.flycast`) is the alternative when you want Fly Proxy features such as autostart for internal traffic (<https://docs.fly.io/networking/flycast>), which Tap does not need.
- **Health check.** `fly/tap.toml` uses a TCP check on port 2480. An HTTP check on `/health` returns 401 in Tap 0.1.10 because it requires the admin password (seen in staging on November 4, 2026), and the password cannot be committed in the config.
- **Jetstream fallback.** Tap is in beta. If it fails, switch the indexer to Jetstream (<https://atproto.com/guides/streaming-data>). That needs an indexer change to filter the same collections and does not exist yet.

### Live Tap test

`apps/indexer/src/tap-live.test.ts` runs the indexer path against a real Tap (issue #42). The full description, the self-contained local run (`pnpm tap:live:local`, local PDS and PLC plus the pinned Tap image, no real accounts), the manual GitHub Actions workflow, and what has and has not been verified are in `docs/testing-live-tap-v1.md`. It skips in CI because neither `LIVE_TAP_TEST` nor `TAP_LIVE_URL` is set.

The rest of this section is external mode, against a staging Tap and a test account you own.

Run it after a staging deploy:

1. Create a throwaway Bluesky account for tests and an app password for it. Do not use a real person's account: the test rewrites `app.bsky.actor.profile/self` and deletes its own records afterward.
2. Stop the staging indexer so it does not compete for events: `fly scale count 0 --app blueyvatar-indexer-staging`. A Tap channel delivers each event to one consumer, and the test acks what it receives. Scale it back to 1 afterward.
3. Make Tap reachable from your machine without a public address: `fly proxy 2480:2480 -a blueyvatar-tap-staging` (Tap has no public IP).
4. Use any Postgres you can create schemas in for `TEST_DATABASE_URL` (a local one is fine; the test creates and drops its own schema). Do not point it at the staging Neon branch.
5. Run:

```sh
export TAP_LIVE_URL=http://localhost:2480
export TAP_LIVE_ADMIN_PASSWORD=...          # STAGING_TAP_ADMIN_PASSWORD from Infisical
export TAP_LIVE_IDENTIFIER=<test handle or DID>
export TAP_LIVE_APP_PASSWORD=<app password>
export TAP_LIVE_PDS_URL=https://bsky.social # PDS of the test account
export TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres
pnpm tap:live                                # tools/tap-live.sh, add TAP_LIVE_CHECK_STATUS=1 for the status step
```

Each wait times out after 90 seconds (`TAP_LIVE_TIMEOUT_MS`). A timeout message lists the events seen for the test DID. Run with `TAP_LIVE_CHECK_STATUS=1` to include the account status check. The local, self-contained run replaces the `docker run` recipe that used to be here.
