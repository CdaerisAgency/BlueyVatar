# BlueyVatar delivery API reference (v1)

The delivery API serves avatars and profile JSON. The delivery host is `https://img.blueyvatar.com`. All paths in these pages are relative to it.

| Page | Covers |
| --- | --- |
| [hashing-v1.md](hashing-v1.md) | Computing the email hash on the client (SHA-256, and MD5 for legacy clients) |
| [json-mode-v1.md](json-mode-v1.md) | The `json=true` response shape and its version policy |
| [format-quality-v1.md](format-quality-v1.md) | The `fmt` and `q` parameters, tier limits, image path format, the square-only size decision, and how the crop and the original size work |
| [cache-ttl-v1.md](cache-ttl-v1.md) | The `ttl` parameter, tier limits, and CDN interaction |
| [gravatar-differences-v1.md](gravatar-differences-v1.md) | Where the API matches Gravatar and where it departs on purpose |
| [exports-and-qr-v3.md](exports-and-qr-v3.md) | Profile downloads (JSON, Markdown, vCard) and QR codes with a logo or avatar in the center |
| [usage-v2.md](usage-v2.md) | `GET /usage`: current period, per-meter counts, and history for a server key |
| [examples-v2.md](examples-v2.md) | Copy-paste examples in curl, JavaScript, and an HTML `<img>` tag |
| [errors-v2.md](errors-v2.md) | Error codes, rate limit headers, and other response headers |

The OpenAPI 3.1 description is served at `/openapi.json` on the delivery host and lives in `apps/delivery/src/openapi.ts`.

Source of truth: `apps/delivery/src/app.ts`, `apps/delivery/src/errors.ts`, `packages/core/src/params.ts`, `packages/core/src/tiers.ts`, and `packages/core/src/hash.ts`.
