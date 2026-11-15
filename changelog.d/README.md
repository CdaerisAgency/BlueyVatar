# Changelog fragments

Each pull request that users or API developers will notice adds one file here instead of editing `CHANGELOG.md`:

`changelog.d/YYYY-MM-DD-short-slug.md`

The date in the name picks the date section the entries join. The file holds one or more `### Added`, `### Changed`, or `### Fixed` headings, each followed by `-` bullet lines, exactly as under a date heading in `CHANGELOG.md`. Do not add a `##` date heading.

The /changelog page and feed merge fragments in at build time. `pnpm changelog:fold` folds them into `CHANGELOG.md` and deletes them. This README and any file not named like the pattern above are ignored.
