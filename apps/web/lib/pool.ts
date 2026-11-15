import pg from 'pg'

const g = globalThis as Record<string, unknown>

/** The shared Postgres pool, or null when DATABASE_URL is unset (in-memory dev mode). */
export function getPool(): pg.Pool | null {
  if (!process.env.DATABASE_URL) return null
  g.__bvPool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX) || 5 })
  return g.__bvPool as pg.Pool
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
