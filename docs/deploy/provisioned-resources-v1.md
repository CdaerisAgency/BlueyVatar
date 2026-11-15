# Provisioned resources

- Neon project `blueyvatar` (ID `rough-heart-79040132`), region `aws-us-east-1` (N. Virginia, near Fly `iad`), Postgres 16, created November 3, 2026.
  - Branch `production` (default; 0.25 to 1 CU autoscaling, suspends after Neon's default idle period (owner decision: keep suspend on idle)), database `blueyvatar`, role `blueyvatar_app`.
  - Branch `staging` (0.25 to 1 CU, suspends after 5 minutes idle).
  - Connection strings come from the Neon console or API and go into Infisical; they are never committed. The pooled host contains `-pooler`; the direct host (for migrations) is the same host without it.

- Infisical project `blueyvatar` (ID `0851796f-0fa5-4321-9f50-3ae11e821cd9`), environments `dev`, `staging`, `prod`; only `prod` is used. It holds `STAGING_DATABASE_URL`, `STAGING_DATABASE_URL_DIRECT`, `STAGING_ORIGIN_SECRET`, `STAGING_SESSION_SECRET`, `STAGING_TAP_ADMIN_PASSWORD`, `STAGING_OAUTH_PRIVATE_JWK`, plus `RESEND_API_KEY` and `EMAIL_FROM` (shared by both). `RESEND_API_KEY` is the shared platform key also used by Muster CRM and Cadence V2. `EMAIL_FROM` uses `mail.cdaeris.com`, the only domain verified in Resend, until `blueyvatar.com` is verified. Cloudflare values are not set yet.
- Fly staging apps in the `personal` organization, region `iad`, created November 4, 2026: `blueyvatar-tap-staging` (volume `tap_data`, ID `vol_r1jd8enn1q2dj19r`, 10 GB as created; volumes cannot shrink, so recreate it at 1 GB to match low-resource mode), `blueyvatar-delivery-staging`, `blueyvatar-indexer-staging`, `blueyvatar-web-staging`.
  - Deployed: tap (image `0.1.10`, TCP check passing), delivery (five migrations applied to the Neon `staging` branch; `/healthz` returns 200, a direct hit on `/u/x` returns 403 `origin_forbidden`), indexer (running; Cloudflare purges logged only).
  - Not deployed: web, which waits on the Cloudflare setup and the `TRUSTED_PDS_HOSTS` value.
