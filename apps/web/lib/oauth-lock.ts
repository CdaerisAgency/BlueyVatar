import type { RuntimeLock } from '@atproto/oauth-client-node'
import type pg from 'pg'
import { getLockPool } from './pool'

const g = globalThis as { __bvOauthLocks?: Map<string, Promise<unknown>> }

/**
 * How long to wait for another holder of the same lock. The OAuth client holds it for at most 30 s (its refresh
 * timeout), so 35 s means a waiter never gives up on a live holder. Running without the lock is not an option: the
 * client then refreshes with a token another caller just used, gets invalid_grant, and deletes the stored session.
 */
const LOCK_WAIT = '35s'

/** The lock could not be had (pool busy or holder stuck). The session is fine, and fn was not run. */
export class OAuthLockUnavailableError extends Error {
  constructor(reason: 'connect' | 'lock', cause: unknown) {
    super(`OAuth lock unavailable (${reason})`, { cause })
  }
}

/** In-process fallback for local dev with no DATABASE_URL: one promise chain per name. */
function inProcess<T>(name: string, fn: () => T | PromiseLike<T>): Promise<T> {
  const chains = (g.__bvOauthLocks ??= new Map())
  const prev = chains.get(name) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  chains.set(name, tail)
  void tail.then(() => {
    if (chains.get(name) === tail) chains.delete(name)
  })
  return run
}

type Held = { client: pg.PoolClient; broken: () => boolean; detach: () => void }

/** Takes a session level advisory lock on a client from the dedicated lock pool. Throws OAuthLockUnavailableError. */
async function acquire(pool: pg.Pool, key: string): Promise<Held> {
  let client: pg.PoolClient
  try {
    client = await pool.connect()
  } catch (err) {
    throw new OAuthLockUnavailableError('connect', err)
  }
  // The pool drops its own error listener while a client is checked out. Without one, a dropped connection would
  // crash the process.
  let failed = false
  const onError = (): void => {
    failed = true
  }
  client.on('error', onError)
  const held: Held = { client, broken: () => failed, detach: () => client.removeListener('error', onError) }
  try {
    await client.query(`SET lock_timeout = '${LOCK_WAIT}'`)
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [key])
    return held
  } catch (err) {
    held.detach()
    client.release(true)
    throw new OAuthLockUnavailableError('lock', err)
  }
}

async function release(held: Held, key: string): Promise<void> {
  const { client } = held
  let destroy = held.broken()
  if (!destroy) {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key])
    } catch {
      destroy = true
    }
  }
  held.detach()
  // A session level lock must not stay on a pooled connection, so a failed or broken one is dropped, which frees it.
  client.release(destroy)
}

/**
 * Lock for the OAuth client, passed as `requestLock`. The client takes it around every session read (restore and
 * each authenticated request) and around token refresh, with the library's name `@atproto-oauth-client-<did>`.
 * Refresh tokens are single use, so two machines refreshing one account at once can revoke the stored session.
 *
 * With a database the lock is a Postgres advisory lock named `oauth-lock:<library name>`, shared by every machine.
 * It is taken on a dedicated small pool (OAUTH_LOCK_POOL_MAX), so a holder never uses a connection the session
 * store needs. If the lock cannot be had in time, this throws OAuthLockUnavailableError and does not run `fn`.
 * Without a database the lock serializes within this process.
 */
export const oauthRequestLock: RuntimeLock = async <T>(name: string, fn: () => T | PromiseLike<T>): Promise<T> => {
  const pool = getLockPool()
  if (!pool) return inProcess(name, fn)
  const key = `oauth-lock:${name}`
  const held = await acquire(pool, key)
  try {
    return await fn()
  } finally {
    await release(held, key)
  }
}
