# Deploy from a local clone (localdeploy.bat)

`localdeploy.bat` at the repo root deploys from a Windows machine that has flyctl signed in. It syncs a clone (default `C:\dev\blueyvatar`, cloned if missing) with `origin/main`, stops on uncommitted changes, then deploys delivery, web, and indexer in that order. Delivery goes first because its release command runs the migrations. Tap is not included. When production is part of the run, the last step publishes the lexicons with `pnpm lexicons:publish` (see Publish lexicons). A staging-only run never does.

Run it with no options for a menu: staging, production, both, or quit. Production asks for the typed phrase `DEPLOY PRODUCTION`. Each app asks for a Y or N before it deploys.

For a command line or a scheduled run, pass options so it never waits for input:

| Option | Meaning |
| --- | --- |
| `--env staging`, `--env production`, `--env both` | Where to deploy. `both` runs staging first, then production, and stops if staging fails. |
| `--yes` | No prompts. Needs `--env`. |
| `--confirm-production` | Required with `--yes` when production is included. It replaces the typed phrase. |
| `--repo PATH` | Use another clone. |
| `--no-sync` | Skip the fetch and pull and deploy what is checked out. |
| `--no-pause` | Do not wait for a key at the end. |
| `--no-lexicons` | Skip the lexicon publish after production. |

```
localdeploy.bat --env staging --yes
localdeploy.bat --env both --yes --confirm-production
```

The lexicon step asks "Final step: publish lexicons. Continue" unless `--yes` is given. The command reads `LEXICON_PUBLISH_IDENTIFIER`, `LEXICON_PUBLISH_APP_PASSWORD`, and `LEXICON_PUBLISH_SERVICE` from the environment and does not prompt. The script checks that all three are set, and that `pnpm` is on PATH, before any deploy starts, and stops with exit code 1 if not (use `--no-lexicons` to skip). It never prints their values. If the publish itself fails, the deploys have already finished and the script says so and exits 1.

Exit codes: 0 done, 1 failed, 2 bad usage, 3 stopped by the user. Without `--yes`, a failure or a declined step stops the run and later steps do not run. Check each site and `fly status` afterward.
