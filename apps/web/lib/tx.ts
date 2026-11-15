import type pg from 'pg'

class Abort<T> {
  constructor(readonly value: T) {}
}

/**
 * Runs `fn` inside BEGIN/COMMIT on one pooled client. An error rolls back and rethrows; the client is always released.
 * `lock` takes `pg_advisory_xact_lock(hashtext(key))` for each key, in order, right after BEGIN.
 * Calling `abort(value)` inside `fn` rolls back and makes `inTx` resolve to `value`.
 */
export async function inTx<T>(
  pool: pg.Pool,
  fn: (c: pg.PoolClient, abort: (value: T) => never) => Promise<T>,
  opts: { lock?: string | string[] } = {},
): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    for (const key of [opts.lock ?? []].flat()) await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key])
    const out = await fn(c, (value) => {
      throw new Abort(value)
    })
    await c.query('COMMIT')
    return out
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {})
    if (err instanceof Abort) return err.value as T
    throw err
  } finally {
    c.release()
  }
}
