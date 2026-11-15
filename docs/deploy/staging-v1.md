# Staging

Staging runs as a second set of Fly apps in the same organization, named `blueyvatar-<app>-staging`. The configs in `fly/` keep the production app names, so staging overrides them on the command line. Staging uses the Neon `staging` branch. Its secrets live in the Infisical `prod` environment under a `STAGING_` prefix (see Infisical secrets).

```sh
fly apps create blueyvatar-tap-staging   # repeat for web, delivery, indexer
fly volumes create tap_data --app blueyvatar-tap-staging --region iad --size 1

fly deploy --config fly/tap.toml --app blueyvatar-tap-staging
fly deploy --config fly/delivery.toml --app blueyvatar-delivery-staging --dockerfile Dockerfile --remote-only
fly deploy --config fly/web.toml --app blueyvatar-web-staging --dockerfile Dockerfile --remote-only
fly deploy --config fly/indexer.toml --app blueyvatar-indexer-staging --dockerfile Dockerfile --remote-only \
  --env TAP_URL=http://blueyvatar-tap-staging.internal:2480
```

The indexer needs the `--env` override because `fly/indexer.toml` points at the production Tap. The CI workflow deploys these staging apps too (see CI deploys). Tap staging is deployed by hand.
