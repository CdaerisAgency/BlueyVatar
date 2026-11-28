# Gitea (v1)

Point Gitea's Gravatar source at BlueyVatar so people on your self-hosted Gitea see their BlueyVatar avatar. It takes under five minutes and needs no plugin.

## What you change

The Gravatar source setting in `app.ini`, or the same setting in the Admin Panel.

## Steps

1. In `app.ini`, set the source:

   ```ini
   [picture]
   GRAVATAR_SOURCE = https://img.blueyvatar.com/avatar/
   ```

   The Admin Panel has the same setting if you prefer to change it there.
2. Make sure `OFFLINE_MODE` and `DISABLE_GRAVATAR` are off. Either one turns Gravatar lookups off, so the source is never used.
3. Leave federated avatar mode off. It relies on DNS discovery that BlueyVatar does not offer yet.
4. Restart Gitea.

Current Gitea sends a SHA-256 hash of the email, and it adds `s=` for the size. BlueyVatar accepts both MD5 and SHA-256, so any Gitea version works for every linked email ([hashing-v1.md](../api/hashing-v1.md#md5-for-legacy-clients)).

## Check it worked

Open a user profile on your Gitea for someone who has a verified email on BlueyVatar. Right-click the avatar, copy the image address, and confirm it starts with `https://img.blueyvatar.com/avatar/`. The image should be their BlueyVatar avatar.

## Without a BlueyVatar avatar

Gitea adds `d=identicon` to the request it builds from `GRAVATAR_SOURCE`. A person with no BlueyVatar avatar, or whose email is not verified on BlueyVatar, sees a generated identicon pattern instead of a broken image.

## Limits

BlueyVatar sets how many avatar requests and what sizes a site can use, and the limits can change. See [pricing](https://blueyvatar.com/pricing) for what applies to you.
