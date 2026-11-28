import type { RuntimeLock } from '@atproto/oauth-client-node'
import { getPool } from './pool'
import { inTx } from './tx'

const g = globalThis as { __bvOauthLocks?: Map<string, Promise<unknown>> }

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

/**
 * Lock for OAuth token refresh, passed to the client as `requestLock`. Refresh tokens are single use, so two
 * machines refreshing the same account at once can revoke the stored session. With a database the lock is a
 * Postgres advisory lock shared by every machine; the second caller waits, then finds the fresh tokens. Without
 * one it serializes within this process.
 */
export const oauthRequestLock: RuntimeLock = async <T>(name: string, fn: () => T | PromiseLike<T>): Promise<T> => {
  const pool = getPool()
  if (!pool) return inProcess(name, fn)
  return inTx(pool, async () => fn(), { lock: `oauth-refresh:${name}` })
}
