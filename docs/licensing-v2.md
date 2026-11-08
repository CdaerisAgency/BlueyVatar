# Licensing (v2)

BlueyVatar is licensed per component. Each directory below carries its own `LICENSE` file, and the root `LICENSE` is the AGPL text that covers the default case.

| Path | License | SPDX |
| --- | --- | --- |
| `apps/delivery` | GNU Affero General Public License v3 | `AGPL-3.0-only` |
| `apps/indexer` | GNU Affero General Public License v3 | `AGPL-3.0-only` |
| `apps/web` | GNU Affero General Public License v3 | `AGPL-3.0-only` |
| `packages/core` | GNU Affero General Public License v3 | `AGPL-3.0-only` |
| `packages/avatar` | GNU Affero General Public License v3 | `AGPL-3.0-only` |
| `packages/hovercards` | GNU Affero General Public License v3 | `AGPL-3.0-only` |
| `tools/migrate` | GNU Affero General Public License v3 | `AGPL-3.0-only` |
| `lexicons/com/blueyvatar` | Apache License 2.0 | `Apache-2.0` |

## Why two licenses

The services, the shared core, the packages, and the migration tool use the AGPL, so anyone who runs a modified copy as a network service must publish their changes. The lexicons are the public data schemas that other apps on atproto implement, so they use Apache 2.0 to make adoption easy.

## What each part covers

- **Apps (`apps/delivery`, `apps/indexer`, `apps/web`) and `packages/core`:** AGPL-3.0-only.
- **`packages/avatar`** (URL builder and React component that run in customer apps) and **`packages/hovercards`** (script that runs on third-party pages): AGPL-3.0-only. The owner chose this in place of the earlier `UNLICENSED` marking. Anyone who copies this code into their own software takes on the AGPL terms for that code.
- **`tools/migrate`:** AGPL-3.0-only. It now carries a `LICENSE` file and a `license` field.
- **`lexicons/com/blueyvatar`:** Apache-2.0.
- **`lexicons/vendor`:** third-party lexicons that keep their original terms.
- **`integrations/wordpress`:** Apache-2.0, as its own `LICENSE` file states.
- Other tools under `tools/` (`lexicon`, `loadtest`, `smoke`) are private and have no license field yet. The owner has not decided on them.

A hovercards or avatar key (`pk_`, `sk_`) and a paid plan are access terms for the hosted service. They do not change the license of the code.

## Status

The repository is private and has no public release date. Nobody should call the project open source until the repository is actually public. Once the repository is public, the AGPL-3.0-only parts can be described as open source, and this page should say which license covers each part.
