# TOKEN_ENCRYPTION_KEY and sign-outs

`TOKEN_ENCRYPTION_KEY` encrypts the stored OAuth sessions (the link to each person's atproto account) in Postgres. Changing or rotating it on a running environment makes every stored session unreadable. Nobody is signed out of the website itself (the `bv_session` cookie uses `SESSION_SECRET`), but the next time web needs the saved link to the person's account, restore fails. Pages such as `/account/profile` then show "You are signed in to blueyvatar, but the link to your account's home server needs to be renewed" with a Sign in again link, and the server log carries `oauth restore failed` with the error class (never the message or any token).

Plan a key change as a sign-out for everyone: announce it first, change the key on web and indexer together, and expect people to sign in again once. Stored primary emails become unreadable too (see Migrations).

### OAuth request lock

Refresh tokens are single use, so two machines refreshing one account at once can revoke the stored session. The OAuth client takes a lock around every session read (restore and each authenticated request to the person's home server) and around token refresh, so web passes it a request lock. With `DATABASE_URL` set the lock is a Postgres advisory lock named `oauth-lock:@atproto-oauth-client-<did>`, shared by every Fly machine (look for it in `pg_locks`). Without it (local dev) the lock works inside one process.

The lock uses its own small pool (`OAUTH_LOCK_POOL_MAX`, default 4, 3 second connect timeout), separate from `PG_POOL_MAX`, so a lock holder never takes a connection the session store needs. If the lock cannot be had within about 5 seconds, the request runs without it and the log shows `oauth lock unavailable`. That is the old unlocked behavior, so a few of these lines are harmless, and a steady stream means the lock pool or a slow home server needs a look.
