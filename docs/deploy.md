# Deploy runbook

Covers staging and production on Fly.io with Neon Postgres, behind Cloudflare's free plan (spec sections 14 and 14.1). Primary region is `iad`. Nothing here has been deployed yet. Items marked **unconfirmed** were not verified against a source.

This page is an index. Each topic lives in its own file under `docs/deploy/`. A new feature adds its own file there (named `<topic>-v1.md`) and one line below, instead of editing a shared file.

- [Apps and Neon](deploy/apps-and-neon-v1.md)
- [Migrations](deploy/migrations-v1.md)
- [First-time setup](deploy/first-time-setup-v1.md)
- [Staging](deploy/staging-v1.md)
- [CI deploys, rollback, and the public repository checklist](deploy/ci-deploys-v1.md)
- [Deploy from a local clone (localdeploy.bat)](deploy/local-deploy-v1.md)
- [Tap and the live Tap test](deploy/tap-v1.md)
- [Cloudflare](deploy/cloudflare-v1.md)
- [Web rate limits](deploy/rate-limits-v1.md)
- [Bug reports](deploy/bug-reports-v1.md)
- [Email routing and notification emails](deploy/email-v1.md)
- [CDN cache warming](deploy/cdn-warming-v1.md)
- [Upload screening and atproto labels](deploy/upload-screening-v1.md)
- [Blocking an image and the web admin page](deploy/blocking-images-v1.md)
- [Stripe billing](deploy/stripe-v1.md)
- [Linked account providers](deploy/linked-account-providers-v1.md)
- [Infisical secrets](deploy/infisical-secrets-v1.md)
- [Publish the lexicons](deploy/lexicons-v1.md)
- [Original blob cache](deploy/original-blob-cache-v1.md)
- [Observability](deploy/observability-v1.md)
- [Log retention](deploy/log-retention-v1.md)
- [Publish the npm packages and the release checklist](deploy/npm-and-release-v1.md)
- [Low-resource mode](deploy/low-resource-mode-v1.md)
- [Provisioned resources](deploy/provisioned-resources-v1.md)
- [Account data deletion and billing retention](deploy/account-data-deletion-v1.md)
- [Avatar push permission](deploy/avatar-push-permission-v1.md)
- [TOKEN_ENCRYPTION_KEY and sign-outs](deploy/token-encryption-key-v1.md)
