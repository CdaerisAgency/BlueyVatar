# Discourse (v1)

Discourse downloads Gravatar images on the server. Its source builds the URL from a site setting, so a self-hosted forum can point that setting at BlueyVatar with no plugin.

## How Discourse builds the URL

In `app/models/user_avatar.rb`, `download_gravatar!` requests `https://{gravatar_base_url}/avatar/{email_hash}.png?s={size}&d=404&reset_cache=...` ([source](https://github.com/discourse/discourse/blob/main/app/models/user_avatar.rb)). `User.email_hash` is the MD5 of the trimmed, lowercased email ([source](https://github.com/discourse/discourse/blob/main/app/models/user.rb)). The setting `gravatar_base_url` defaults to `www.gravatar.com` and is marked hidden in `config/site_settings.yml` ([source](https://github.com/discourse/discourse/blob/main/config/site_settings.yml)), so it does not appear in the admin settings list. Discourse administrators have used the same setting to switch to Libravatar ([Fedora Discussion thread](https://discussion.fedoraproject.org/t/change-to-libravatar-for-default-user-avatars/28853)).

How BlueyVatar answers that request:

- The path `/avatar/{hash}.png` works. The API strips a trailing `.png` and lowercases the hash.
- `d=404` returns a 404 when there is no avatar, which Discourse treats as no Gravatar. The extra `reset_cache` parameter is not part of the API.
- The hash is MD5. blueyvatar answers to MD5 only for emails verified after migration 0006, so a person must verify their email on blueyvatar first. See [hashing-v1.md](../api/hashing-v1.md#md5-for-legacy-clients).
- The request comes from your server, so a browser referrer policy does not apply. Discourse then stores the image as an upload.

## Set it

Hidden settings are changed from the Rails console on the server. For a standard Docker install:

```sh
cd /var/discourse
./launcher enter app
rails c
```

```ruby
SiteSetting.gravatar_base_url = 'img.blueyvatar.com'
```

The value is a host name with no `https://` and no trailing slash, because Discourse adds the scheme and path itself. The base host is a placeholder until the final delivery host is announced.

Two related hidden settings, `gravatar_name` and `gravatar_login_url`, exist in the same file. This guide does not change them.

## Limits

- A user whose email is not verified on blueyvatar keeps the Discourse letter avatar.
- Discourse caches the downloaded image. Existing users get the new image when Discourse next refreshes it, not at once.
- This was written from the Discourse source and has not been run against a live forum. Try it on a staging forum first.

Spec reference: section 3 row 8, "switch by changing a base URL".
