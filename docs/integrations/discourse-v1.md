# Discourse (v1)

Discourse downloads Gravatar images on the server. Its source builds the URL from a site setting, so a self-hosted forum can point that setting at BlueyVatar with no plugin.

## What you change

The hidden `gravatar_base_url` site setting, set from the Rails console or in `app.yml`.

## Steps

The setting is hidden, so it does not appear in the admin settings list. Use one of these two ways on the server. The Rails console is the immediate one. The environment variable in `app.yml` is the durable option and survives rebuilds. The value is a host name with no `https://` and no trailing slash, because Discourse adds the scheme and path itself.

### Option 1: Rails console

For a standard Docker install:

```sh
cd /var/discourse
./launcher enter app
rails c
```

```ruby
SiteSetting.gravatar_base_url = "img.blueyvatar.com"
```

The change applies at once, but a later rebuild with `DISCOURSE_GRAVATAR_BASE_URL` set overrides it, so pick one option. Type `exit` to leave the console, then `exit` again to leave the container.

### Option 2: app.yml

Add the setting to the `env` section of `containers/app.yml`:

```yaml
env:
  DISCOURSE_GRAVATAR_BASE_URL: img.blueyvatar.com
```

The variable overrides a value set in the console. Rebuild so the container picks it up:

```sh
cd /var/discourse
./launcher rebuild app
```

Two related hidden settings, `gravatar_name` and `gravatar_login_url`, exist in the same file. This guide does not change them.

Discourse sends an MD5 hash of the email. BlueyVatar answers MD5 only for emails verified after MD5 support was added, so each person verifies their email on BlueyVatar once ([hashing-v1.md](../api/hashing-v1.md#md5-for-legacy-clients)).

## Check it worked

Once any rebuild has finished, ask a test user with a verified BlueyVatar email to refresh their avatar from their Discourse preferences, then open their profile. The avatar should be their BlueyVatar image. Discourse stores the image as an upload, so the image address on the page points at your own forum's uploads.

## How Discourse builds the URL

In `app/models/user_avatar.rb`, `download_gravatar!` requests `https://{gravatar_base_url}/avatar/{email_hash}.png?s={size}&d=404&reset_cache=...` ([source](https://github.com/discourse/discourse/blob/main/app/models/user_avatar.rb)). `User.email_hash` is the MD5 of the trimmed, lowercased email ([source](https://github.com/discourse/discourse/blob/main/app/models/user.rb)). The setting `gravatar_base_url` defaults to `www.gravatar.com` and is marked hidden in `config/site_settings.yml` ([source](https://github.com/discourse/discourse/blob/main/config/site_settings.yml)). Discourse administrators have used the same setting to switch to Libravatar ([Fedora Discussion thread](https://discussion.fedoraproject.org/t/change-to-libravatar-for-default-user-avatars/28853)).

How BlueyVatar answers that request:

- The path `/avatar/{hash}.png` works. The API strips a trailing `.png` and lowercases the hash.
- `d=404` returns a 404 when there is no avatar, which Discourse treats as no Gravatar. The extra `reset_cache` parameter is not part of the API.
- The request comes from your server, so a browser referrer policy does not apply.

## Discourse stores the avatar once

Discourse downloads each avatar one time and keeps it as an upload. Changing the setting does not rewrite avatars already stored, and later changes a person makes on BlueyVatar do not show until that person refreshes their avatar on your forum.

## Without a BlueyVatar avatar

Discourse sends `d=404` in its request. A person with no BlueyVatar avatar, or whose email is not verified on BlueyVatar, gets a 404 from BlueyVatar, so Discourse keeps its letter avatar. No identicon is shown.

## Limits

- A user whose email is not verified on BlueyVatar keeps the Discourse letter avatar.
- A large forum downloads every avatar from one server, so all those requests come from a single place. BlueyVatar's limits are set by its administrators and can change. If your forum is large, contact support about a limit for your site. See [pricing](https://blueyvatar.com/pricing).
- This was written from the Discourse source and has not been run against a live forum. Try it on a staging forum first.
