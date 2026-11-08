# BlueyVatar delivery API reference (v1)

The delivery API serves avatars and profile JSON. The proposed delivery host is `https://img.blueyvatar.com`. This host is not final, so write it as a configurable base URL in your client and expect the docs to name the final host before launch. All paths in these pages are relative to that base URL.

| Page | Covers |
| --- | --- |
| [hashing-v1.md](hashing-v1.md) | Computing the email hash on the client (SHA-256, and MD5 for legacy clients) |
| [json-mode-v1.md](json-mode-v1.md) | The `json=true` response shape and its version policy |
| [format-quality-v1.md](format-quality-v1.md) | The `fmt` and `q` parameters, tier limits, image path format, the square-only size decision, and how the crop and the original size work |
| [cache-ttl-v1.md](cache-ttl-v1.md) | The `ttl` parameter, tier limits, and CDN interaction |
| [gravatar-differences-v1.md](gravatar-differences-v1.md) | Where the API matches Gravatar and where it departs on purpose |
| [exports-and-qr-v1.md](exports-and-qr-v1.md) | Profile downloads (JSON, Markdown, vCard) and QR codes with a logo or avatar in the center |
| [usage-v1.md](usage-v1.md) | `GET /usage`: current period, per-meter counts, and history for a secret key |
| [examples-v1.md](examples-v1.md) | Copy-paste examples in curl, JavaScript, and an HTML `<img>` tag |
| [errors-v1.md](errors-v1.md) | Error codes, rate limit headers, and other response headers |

## Integration guides

| Guide | Covers |
| --- | --- |
| [html-v1.md](../integrations/html-v1.md) | Plain HTML: hash route, `d=` fallback, no-referrer |
| [wordpress-v1.md](../integrations/wordpress-v1.md) | The WordPress plugin, its license, and submission steps |
| [ghost-v1.md](../integrations/ghost-v1.md) | Ghost themes and code injection |
| [discourse-v1.md](../integrations/discourse-v1.md) | Discourse's `gravatar_base_url` setting |

The OpenAPI 3.1 description is served at `/openapi.json` on the delivery host and lives in `apps/delivery/src/openapi.ts`.

Source of truth: `apps/delivery/src/app.ts`, `apps/delivery/src/errors.ts`, `packages/core/src/params.ts`, `packages/core/src/tiers.ts`, and `packages/core/src/hash.ts`.
