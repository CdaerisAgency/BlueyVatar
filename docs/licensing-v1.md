# Licensing (v1)

BlueyVatar is licensed per component. Each directory below carries its own `LICENSE` file, and the root `LICENSE` is the AGPL text that covers the default case.

| Path | License | SPDX |
| --- | --- | --- |
| `apps/delivery` | GNU Affero General Public License v3 | `AGPL-3.0-only` |
| `apps/indexer` | GNU Affero General Public License v3 | `AGPL-3.0-only` |
| `apps/web` | GNU Affero General Public License v3 | `AGPL-3.0-only` |
| `packages/core` | GNU Affero General Public License v3 | `AGPL-3.0-only` |
| `lexicons/com/blueyvatar` | Apache License 2.0 | `Apache-2.0` |

## Why two licenses

The services and the shared core use the AGPL, so anyone who runs a modified copy as a network service must publish their changes. The lexicons are the public data schemas that other apps on atproto implement, so they use Apache 2.0 to make adoption easy.

## Not yet decided

- `packages/hovercards` (script that runs on third-party pages) stays `UNLICENSED` until the owner chooses.
- `tools/migrate` has no license yet.
- `lexicons/vendor` holds third-party lexicons that keep their original terms.

## Status

The repository is private and has no public release date. Do not describe the project as open source on the website until the repository is public.
