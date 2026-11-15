# Web rate limits

The web app limits its expensive or abusable actions with fixed windows stored in the `rate_windows` table (the same table delivery uses, keys prefixed `web:`). Counts are shared by every web instance. Keys hold a salted SHA-256 of the IP or DID, never the raw value; the salt is `REPORT_IP_SECRET`, falling back to `SESSION_SECRET`. Expired rows are removed by the delivery cleanup job. Limits live in `BUCKETS` in `apps/web/lib/rate-limit.ts`.

Client IP: the web app reads `CF-Connecting-IP` only when the request carries `x-origin-auth` equal to `ORIGIN_SECRET`. Set `ORIGIN_SECRET` on the web app (the same value the Cloudflare transform rule sends) and add that rule for the web hostname too, in step 5 of the Cloudflare section. Without it the app falls back to `Fly-Client-IP`, which behind Cloudflare is an edge address, so many users would share one IP bucket. `X-Forwarded-For` is never trusted.

When a limit is hit, server actions show "Too many requests. Try again in N minutes." and route handlers answer 429 with `Retry-After` in seconds. If the database check itself fails, the request is allowed and the error is logged.

| Bucket | Counted by | Limit | Window |
| --- | --- | --- | --- |
| `login.ip` (login start) | IP | 20 | 10 min |
| `login.did` (email link OAuth start) | DID | 10 | 10 min |
| `loginFail.ip` (bad handle or failed sign-in start, then lockout) | IP | 10 failures | 15 min |
| `callback.ip` (OAuth and claim callbacks) | IP | 60 | 10 min |
| `import.did`, `import.ip` (avatar import preview and confirm) | DID, IP | 20, 60 | 10 min |
| `claimAdd.did` | DID | 30 | 1 hour |
| `claimVerify.did`, `claimVerify.ip` (verify and re-verify) | DID, IP | 30, 60 | 1 hour |
| `domain.did`, `domain.ip` (add and remove) | DID, IP | 20, 40 | 1 hour |
| `domainRefresh.did` (Cloudflare status poll on the domain page) | DID | 60 | 10 min |
| `upload.did`, `upload.ip` (avatar and gallery uploads) | DID, IP | 30, 90 | 1 hour |
| `key.did`, `key.ip` (create and rotate) | DID, IP | 20, 60 | 1 hour |
| `addEmail.did`, `addEmail.ip` (new codes) | DID, IP | 5, 20 | 1 hour |
| `codeFail.did` (wrong codes across all codes, then lockout) | DID | 10 failures | 1 hour |
| `bugReport.did`, `bugReport.ip` (bug report button) | DID, IP | 5, 20 | 1 hour |

The per-code cap of 5 attempts and the 60 second resend gap still apply. Report submissions keep their own limit of 5 per IP per hour.

Per-account caps, enforced on the server: images by plan (Free 3, Plus 20), gallery images (`GALLERY_MAX`), 10 linked emails, 10 profile links, claims (`MAX_CLAIMS`, checked against both the repo and the database), one custom domain, and active keys by tier. Uploads must carry exactly one file of at most 5 MiB (5,242,880 bytes, the reference PDS default), checked before the file is read, whatever the browser resized. An image above 4096 pixels on the long side is downscaled by the web server with sharp if the browser did not already do it (spec section 5). Server actions accept bodies up to 6 MB.
