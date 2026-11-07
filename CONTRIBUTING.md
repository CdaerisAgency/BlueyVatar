# Contributing

## Setup

Requirements: Node 22 and pnpm 10.28.0 (`corepack enable` picks up the version from `package.json`).

```sh
pnpm install
cp .env.example .env            # optional for local runs
pnpm lex:build                  # generate lexicon types
pnpm --filter @blueyvatar/core build
```

See the README for the repository layout and how to run each service.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm -r typecheck` | Typecheck every package |
| `pnpm -r test` | Run every test suite |
| `pnpm -r build` | Build every package |
| `pnpm db:migrate` | Apply `db/migrations` to the database in `DATABASE_URL` |
| `pnpm lex:build` | Regenerate lexicon types |
| `pnpm lex:install <nsid>` | Install a third-party lexicon into `lexicons/vendor` |

## Tests with a local Postgres

The Postgres integration tests run when `TEST_DATABASE_URL` is set and skip otherwise. Each run creates and drops its own schema, so a shared scratch database is fine. CI uses `postgres:16`:

```sh
docker run -d --name blueyvatar-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=blueyvatar_test -p 5432:5432 postgres:16
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/blueyvatar_test
DATABASE_URL=$TEST_DATABASE_URL pnpm db:migrate
pnpm -r test
```

## Migrations

Add a new numbered file to `db/migrations`. The runner applies files in filename order and does not rerun applied files, so never edit a migration that has shipped.

## Pull requests

- Branch from `main` and open the PR against `main`.
- CI must pass (typecheck, tests, web build, Docker build).
- Use merge commits. Do not rebase. If `main` moves, merge `origin/main` into your branch.
- Put `Closes #N` in the PR description for the issue it finishes, or `Refs #N` when it only contributes.
- Write U.S. English and do not use em-dashes.
- Never commit secrets or a filled-in `.env`.

## Security

Report vulnerabilities as described in [SECURITY.md](SECURITY.md), not in public issues.
