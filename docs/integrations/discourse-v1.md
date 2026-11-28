# Discourse (v1)

Discourse downloads Gravatar images on the server. Its source builds the URL from a site setting, so a self-hosted forum can point that setting at BlueyVatar with no plugin.

## How Discourse builds the URL

In `app/models/user_avatar.rb`, `download_gravatar!` requests `https://{gravatar_base_url}/avatar/{email_hash}.png?s={size}&d=404&reset_cache=...` ([source](https://github.com/discourse/discourse/blob/main/app/models/user_avatar.rb)). `User.email_hash` is the MD5 of the trimmed, lowercased email ([source](https://github.com/discourse/discourse/blob/main/app/models/user.rb)). The setting `gravatar_base_url` defaults to `www.gravatar.com` and is marked hidden in `config/site_settings.yml` ([source](https://github.com/discourse/discourse/blob/main/config/site_settings.yml)), so it does not appear in the admin settings list. Discourse administrators have used the same setting to switch to Libravatar ([Fedora Discussion thread](https://discussion.fedoraproject.org/t/change-to-libravatar-for-default-user-avatars/28853)).

How BlueyVatar answers that request:

- The path `/avatar/{hash}.png` works. The API strips a trailing `.png` and lowercases the hash.
- `d=404` returns a 404 when there is no avatar, which Discourse treats as no Gravatar. The extra `reset_cache` parameter is not part of the API.
- The hash is MD5. BlueyVatar answers to MD5 only for emails verified after migration 0006, so a person must verify their email on BlueyVatar first. See [hashing-v1.md](../api/hashing-v1.md#md5-for-legacy-clients).
- The request comes from your server, so a browser referrer policy does not apply. Discourse then stores the image as an upload.

## Set it

The setting is hidden, so it does not appear in the admin settings list. Use either of these two ways on the server. The value is a host name with no `https://` and no trailing slash, because Discourse adds the scheme and path itself. The base host is a placeholder until the final delivery host is announced.

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

The change applies at once. Type `exit` to leave the console, then `exit` again to leave the container.

### Option 2: app.yml

Add the setting to the `env` section of `containers/app.yml`:

```yaml
env:
  DISCOURSE_GRAVATAR_BASE_URL: img.blueyvatar.com
```

Then rebuild so the container picks it up:

```sh
cd /var/discourse
./launcher rebuild app
```

Two related hidden settings, `gravatar_name` and `gravatar_login_url`, exist in the same file. This guide does not change them.

## Check it worked

Ask a test user with a verified BlueyVatar email to refresh their avatar from their Discourse preferences, then open their profile. The avatar should be their BlueyVatar image. Discourse stores the image as an upload, so the image address on the page belongs to your own forum, not to `img.blueyvatar.com`.

## Discourse stores the avatar once

Discourse downloads each avatar one time and keeps it as an upload. Changing the setting does not rewrite avatars already stored, and later changes a person makes on BlueyVatar do not show until that person refreshes their avatar on your forum.

## Without a BlueyVatar avatar

Discourse sends `d=404` in its request. A person with no BlueyVatar avatar, or whose email is not verified on BlueyVatar, gets a 404 from BlueyVatar, so Discourse keeps its letter avatar. No identicon is shown.

## Limits

- A user whose email is not verified on BlueyVatar keeps the Discourse letter avatar.
- A large forum downloads every avatar from one server, so all those requests come from a single place. BlueyVatar's limits are set by its administrators and can change. Ask the owner to use the site's own limit, or contact support. See [pricing](https://blueyvatar.com/pricing).
- This was written from the Discourse source and has not been run against a live forum. Try it on a staging forum first.

Spec reference: section 3 row 8, "switch by changing a base URL".
