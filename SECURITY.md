# Security policy

Please report vulnerabilities privately. Do not open a public issue or pull request for a security problem.

## What is in scope

- The web app (`apps/web`), the delivery API (`apps/delivery`), and the indexer (`apps/indexer`).
- The shared core (`packages/core`) and the published packages `packages/avatar` and `packages/hovercards`.
- Database migrations (`db/migrations`), the lexicons in `lexicons/com/blueyvatar`, and the tools in `tools/`.
- The production sites run from this code, including sign-in, billing, API keys, and image delivery.

Third-party services we use (for example Cloudflare, Stripe, Fly.io, and atproto servers) have their own policies. Report problems in those services to their owners.

## How to report

Use either of these:

1. Email **security@blueyvatar.com**.
2. Open a private report with GitHub: https://github.com/CdaerisAgency/BlueyVatar/security/advisories/new. This works only after the repository owner turns on private vulnerability reporting in the repository settings. If the link shows an error, use email.

Include what you found, the steps to reproduce it, and the affected component (web, delivery, indexer, or database migrations). Do not include real user data.

Never commit secrets. If you find a secret in the repository history, report it the same way.

## What to expect

These are goals. The owner has not confirmed them yet.

- We aim to acknowledge reports within 3 business days.
- We aim to share an assessment and a fix plan within 10 business days.
- We will tell you when the issue is fixed.

## Supported versions

Only the latest deployed version is supported. Fixes go into the current main branch and the deployed sites. We do not backport fixes to older versions or older package releases.
