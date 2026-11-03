import pg from 'pg'
import { migrate } from './index.js'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
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
