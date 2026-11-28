# Redmine (v1)

Point Redmine's avatar server at BlueyVatar so people on your Redmine see their BlueyVatar avatar. It takes under five minutes and needs no plugin.

## What you change

The `avatar_server_url` value in `config/configuration.yml`.

## Steps

1. In `config/configuration.yml`, set the server (no trailing path):

   ```yaml
   default:
     avatar_server_url: https://img.blueyvatar.com
   ```

2. Restart Redmine so it reads the file.
3. In Administration, Settings, Display, make sure Gravatar is enabled.

Redmine sends a hash of the email. Each person must have a verified email on BlueyVatar for their avatar to show. BlueyVatar accepts SHA-256 always, and MD5 only for emails verified after migration 0006 ([hashing-v1.md](../api/hashing-v1.md#md5-for-legacy-clients)).

## Check it worked

Open a user's page or an issue they commented on. Right-click the avatar, copy the image address, and confirm it starts with `https://img.blueyvatar.com/avatar/`.

## Without a BlueyVatar avatar

Redmine puts its own `d=` value in the avatar URL, and that value decides what visitors see when a person has no BlueyVatar avatar, such as an identicon or a plain default image. To see what yours is, copy the image address of any avatar and read the `d=` part.

## Limits

BlueyVatar sets how many avatar requests and what sizes a site can use, and the limits can change. See [pricing](https://blueyvatar.com/pricing) for what applies to you.
