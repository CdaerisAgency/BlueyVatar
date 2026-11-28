# TOKEN_ENCRYPTION_KEY and sign-outs

`TOKEN_ENCRYPTION_KEY` encrypts the stored OAuth sessions (the link to each person's atproto account) in Postgres. Changing or rotating it on a running environment makes every stored session unreadable. Nobody is signed out of the website itself (the `bv_session` cookie uses `SESSION_SECRET`), but the next time web needs the saved link to the person's account, restore fails. Pages such as `/account/profile` then show "You are signed in to blueyvatar, but the link to your account's home server needs to be renewed" with a Sign in again link, and the server log carries `oauth restore failed` with the error class (never the message or any token).

Plan a key change as a sign-out for everyone: announce it first, change the key on web and indexer together, and expect people to sign in again once. Stored primary emails become unreadable too (see Migrations).

### Concurrent refreshes

Refresh tokens are single use. Web passes a request lock to the OAuth client so only one machine refreshes a given account at a time. With `DATABASE_URL` set the lock is a Postgres advisory lock named `oauth-refresh:<did>`, shared by every Fly machine. Without it (local dev) the lock works inside one process. The lock holds one pooled connection while a refresh runs, so keep `PG_POOL_MAX` at its default or higher.
