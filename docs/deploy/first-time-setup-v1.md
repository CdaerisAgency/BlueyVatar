# First-time setup

```sh
# Apps (once per environment)
fly apps create blueyvatar-web
fly apps create blueyvatar-delivery
fly apps create blueyvatar-indexer
fly apps create blueyvatar-tap

# Tap volume, single machine in iad (1 GB is the smallest size; see Low-resource mode)
fly volumes create tap_data --app blueyvatar-tap --region iad --size 1

# Secrets (see the per-app list below; values come from Infisical)
fly secrets set --app blueyvatar-delivery DATABASE_URL=... DATABASE_URL_DIRECT=... ORIGIN_SECRET=... IMG_SIGNING_SECRET=...
fly secrets set --app blueyvatar-tap TAP_ADMIN_PASSWORD=...

# Deploy. Tap first, delivery before web and indexer.
fly deploy --config fly/tap.toml --dockerfile Dockerfile
fly deploy --config fly/delivery.toml --dockerfile Dockerfile
fly deploy --config fly/web.toml --dockerfile Dockerfile
fly deploy --config fly/indexer.toml --dockerfile Dockerfile
```

Create a deploy token for CI: `fly tokens create deploy --app blueyvatar-delivery` (repeat per app, or use an organization token) and store it as the GitHub secret `FLY_API_TOKEN`. **Unconfirmed:** a single app-scoped deploy token only covers one app, so the workflow needs an org-scoped token (`fly tokens create org`) to deploy all three.
