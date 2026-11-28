import type { RuntimeLock } from '@atproto/oauth-client-node'
import type pg from 'pg'
import { log } from './obs'
import { getLockPool } from './pool'

const g = globalThis as { __bvOauthLocks?: Map<string, Promise<unknown>> }

/** How long to wait for another holder of the same lock before running without it. */
const LOCK_WAIT = '5s'

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

/** Takes a session level advisory lock on a client from the dedicated lock pool. Returns null if it cannot be had in time. */
async function acquire(pool: pg.Pool, key: string): Promise<pg.PoolClient | null> {
  let client: pg.PoolClient
  try {
    client = await pool.connect()
  } catch (err) {
    log.warn('oauth lock unavailable', { reason: 'connect', errorName: err instanceof Error ? err.constructor.name : typeof err })
    return null
  }
  try {
    await client.query(`SET lock_timeout = '${LOCK_WAIT}'`)
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [key])
    return client
  } catch (err) {
    log.warn('oauth lock unavailable', { reason: 'lock', errorName: err instanceof Error ? err.constructor.name : typeof err })
    client.release(true)
    return null
  }
}

async function release(client: pg.PoolClient, key: string): Promise<void> {
  try {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key])
    client.release()
  } catch {
    // A session level lock must not stay on a pooled connection, so drop the connection.
    client.release(true)
  }
}

/**
 * Lock for the OAuth client, passed as `requestLock`. The client takes it around every session read (restore and
 * each authenticated request) and around token refresh, with the library's name `@atproto-oauth-client-<did>`.
 * Refresh tokens are single use, so two machines refreshing one account at once can revoke the stored session.
 *
 * With a database the lock is a Postgres advisory lock named `oauth-lock:<library name>`, shared by every machine.
 * It is taken on a dedicated small pool (OAUTH_LOCK_POOL_MAX), so a holder never uses a connection the session
 * store needs. If the lock cannot be had within a few seconds, `fn` runs without it: the old unlocked behavior is
 * better than failing the request. Without a database the lock serializes within this process.
 */
export const oauthRequestLock: RuntimeLock = async <T>(name: string, fn: () => T | PromiseLike<T>): Promise<T> => {
  const pool = getLockPool()
  if (!pool) return inProcess(name, fn)
  const key = `oauth-lock:${name}`
  const client = await acquire(pool, key)
  if (!client) return fn()
  try {
    return await fn()
  } finally {
    await release(client, key)
  }
}
