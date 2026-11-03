import pg from 'pg'
import { migrate } from './index.js'

// Migrations take a session-level advisory lock, so they need a direct Postgres connection.
// Neon's pooled endpoint (PgBouncer in transaction mode) does not support session-level
// advisory locks reliably, so prefer the direct endpoint when one is configured:
// https://neon.com/docs/connect/connection-pooling
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL
if (!url) {
  console.error('Set MIGRATE_DATABASE_URL, DATABASE_URL_DIRECT, or DATABASE_URL')
  process.exit(1)
}
// dist/cli.js and src/cli.ts both sit two levels below tools/, so the repo root is three levels up.
const dir = process.env.MIGRATIONS_DIR ?? new URL('../../../db/migrations', import.meta.url).pathname
const pool = new pg.Pool({ connectionString: url, max: 1 })
try {
  const applied = await migrate(pool, dir, console.log)
  console.log(applied.length ? `applied ${applied.length} migration(s)` : 'database is up to date')
} catch (err) {
  console.error(err)
  process.exitCode = 1
} finally {
  await pool.end()
}
