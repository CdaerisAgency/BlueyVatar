import pg from 'pg'
import { log } from './obs'

const g = globalThis as Record<string, unknown>

/** The shared Postgres pool, or null when DATABASE_URL is unset (in-memory dev mode). */
export function getPool(): pg.Pool | null {
  if (!process.env.DATABASE_URL) return null
  g.__bvPool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX) || 5 })
  return g.__bvPool as pg.Pool
}

/**
 * A small separate pool for OAuth request locks (lib/oauth-lock.ts), or null without DATABASE_URL. A lock holder keeps
 * its connection while the session store works on the main pool, so the two must never share connections.
 */
export function getLockPool(): pg.Pool | null {
  if (!process.env.DATABASE_URL) return null
  if (!g.__bvLockPool) {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.OAUTH_LOCK_POOL_MAX) || 10,
      connectionTimeoutMillis: 10_000,
    })
    // An idle client that loses its connection emits this. Unhandled, it would crash the process.
    pool.on('error', (err) => log.warn('oauth lock pool error', { errorName: err.constructor.name }))
    g.__bvLockPool = pool
  }
  return g.__bvLockPool as pg.Pool
}

/**
 * One instance per process, kept on globalThis under `key` so dev hot reload reuses it.
 * Postgres when DATABASE_URL is set, otherwise in-memory (dev only, lost on restart).
 */
export function singleton<T>(key: string, makePg: (pool: pg.Pool) => T, makeMem: () => T): T {
  const pool = getPool()
  g[key] ??= pool ? makePg(pool) : makeMem()
  return g[key] as T
}
