# GitLab (v1)

Point GitLab's Gravatar URL at BlueyVatar so people on your self-managed GitLab see their BlueyVatar avatar. It takes under five minutes and needs no plugin.

## What you change

The Gravatar URL templates in your GitLab configuration. GitLab fills in `%{hash}` and `%{size}` for each avatar.

## Steps

1. In `/etc/gitlab/gitlab.rb`, set both URLs:

   ```ruby
   gitlab_rails['gravatar_plain_url'] = 'https://img.blueyvatar.com/avatar/%{hash}?s=%{size}&d=identicon'
   gitlab_rails['gravatar_ssl_url'] = 'https://img.blueyvatar.com/avatar/%{hash}?s=%{size}&d=identicon'
   ```

   If you edit `gitlab.yml` instead, the keys are `gravatar.plain_url` and `gravatar.ssl_url`.
2. Reconfigure GitLab so the change takes effect, for example `sudo gitlab-ctl reconfigure`.
3. Keep Gravatar enabled in GitLab's settings. The URLs above replace where GitLab fetches from.

Current GitLab versions send a SHA-256 hash of the email, which BlueyVatar accepts.

## Check it worked

Open a user profile on your GitLab for someone who has a verified email on BlueyVatar. Right-click the avatar, copy the image address, and confirm it starts with `https://img.blueyvatar.com/avatar/`. The image should be their BlueyVatar avatar.

## Without a BlueyVatar avatar

GitLab adds `d=identicon` in the URL above. A person with no BlueyVatar avatar, or whose email is not verified on BlueyVatar, sees a generated identicon pattern instead of a broken image.

## Limits

BlueyVatar sets how many avatar requests and what sizes a site can use, and the limits can change. See [pricing](https://blueyvatar.com/pricing) for what applies to you.
