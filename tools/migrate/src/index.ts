import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import pg from 'pg'

/** Arbitrary constant so concurrent runners (for example two deploys) take turns. */
const LOCK_KEY = 727_274_001

/** Drop the transaction statements a file carries, because the runner supplies one per file. */
const stripTx = (sql: string) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, '')

/**
 * Applies `*.sql` files in filename order, each in its own transaction, and records
 * the file name in `schema_migrations`. Applied files are skipped, so reruns are safe.
 * Returns the names applied by this run.
 */
export async function migrate(pool: pg.Pool, dir: string, log: (msg: string) => void = () => {}): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  const client = await pool.connect()
  const applied: string[] = []
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
    for (const name of files) {
      if (done.has(name)) continue
      const sql = stripTx(await readFile(join(dir, name), 'utf8'))
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`migration ${name} failed: ${(err as Error).message}`, { cause: err })
      }
      log(`applied ${name}`)
      applied.push(name)
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {})
    client.release()
  }
  return applied
}
