# Integration guides and the /docs guide hub: short design v1

Date: 2026-11-27. Project 4 of 4 in the integrations roadmap. Status: draft for owner approval.

## Why

Goal is reach: site owners should be able to show BlueyVatar avatars with the least work. Many self-hosted platforms already let an admin point their Gravatar URL at another host; a clear guide per platform is the cheapest reach there is. Owner decisions: guides now, plugins later; mobile SDK later (issue only).

## Scope

1. **Four new guides** in `docs/integrations/` (each a one-line setting, confirmed from the platform's source code or official docs):
   - `gitlab-v1.md`: `gitlab_rails['gravatar_plain_url']` and `['gravatar_ssl_url']` in `gitlab.rb` (or `gravatar.plain_url` / `ssl_url` in `gitlab.yml`), template `https://img.blueyvatar.com/avatar/%{hash}?s=%{size}&d=identicon`. Sends SHA-256 on current versions.
   - `gitea-v1.md`: `[picture] GRAVATAR_SOURCE = https://img.blueyvatar.com/avatar/` (or the Admin Panel setting), with `OFFLINE_MODE` / `DISABLE_GRAVATAR` off. Federated avatar mode needs DNS discovery that BlueyVatar does not offer yet (#295), so leave it off.
   - `forgejo-v1.md`: same setting as Gitea; Forgejo sends MD5, which BlueyVatar accepts.
   - `redmine-v1.md`: `avatar_server_url: https://img.blueyvatar.com` in `config/configuration.yml`, restart, Gravatar enabled under Administration > Settings > Display.
2. **Refresh `discourse-v1.md`**: the exact ways to set the hidden `gravatar_base_url` (Rails console, or `DISCOURSE_GRAVATAR_BASE_URL` in `app.yml` and rebuild), and the caveat that Discourse downloads each avatar once and stores it, so later BlueyVatar changes do not show until the user refreshes their avatar.
3. **Guide hub on /docs**: a "Show avatars on your site" section at the top of `/docs` listing every guide with a one-line "what you change" summary and a time estimate (all are under 5 minutes). Guides keep their current `/docs/integrations-<name>` URLs. Add the four names to `INTEGRATIONS` in `apps/web/scripts/build-docs.mjs`.
4. **Each guide has the same shape**: what you change (one line), steps, how to check it worked (open a profile, inspect the image URL), what visitors see without a BlueyVatar avatar (the `d=` default), and a "Limits" note pointing to /pricing.
5. **GitHub issues** (later work, owner decisions recorded):
   - Plugins: phpBB extension (hook `core.get_gravatar_url_after`), Flarum, NodeBB, Zulip (needs a code patch upstream or a fork), a Discourse plugin with a visible setting.
   - Mobile SDKs (Swift, Kotlin): later; mobile apps can use image URLs today.
   - Link Gitea/Forgejo federated mode to #295 (DNS SRV) as a comment.
6. **Delivery fix (separate small PR, same round)**: when an over-limit request asked for `d=404`, return `404` instead of the over-limit picture. A caller that asks for `d=404` is a machine (Discourse's server-side download) that must not store the over-limit picture as someone's permanent avatar. Browser `<img>` requests almost never use `d=404`, so the no-broken-images goal holds. This reverses one call from the admin-settings design ("over limit ignores d").

## Non-goals

- Plugins and mobile SDKs (issues only).
- Guides for platforms without a URL setting (Mastodon, Lemmy, Misskey, Nextcloud, Moodle, Matomo: no email-based avatars or unverified).
- Changing guide URLs.

## Approaches

Owner chose: hub as a section on `/docs` (over a new `/embed` page or a section on `/integrations`, which already means "apps that receive your avatar"). Guides stay Markdown rendered by the existing build-docs pipeline (no other sensible way).

## Constraints

- U.S. English, no em-dashes, `-v1` file names, one `changelog.d/` fragment per PR.
- Copy for the hub section lives in `apps/web/lib/copy*`.
- Do not claim "open source" (repo is private).
- Platform facts that could not be verified from source stay out of the guides.

## Left to the builder

Wording of each guide, the hub layout (follow the existing /docs styles), screenshots (none needed).
