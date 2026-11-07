import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './index.js'

// Runs against a real Postgres when TEST_DATABASE_URL is set; each run uses a throwaway schema.
const url = process.env.TEST_DATABASE_URL
const schema = `t_migrate_${process.pid}_${Date.now()}`
const repoMigrations = new URL('../../../db/migrations', import.meta.url).pathname

describe.skipIf(!url)('migration runner', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
  }, 60_000)
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  }, 60_000)

  it('applies the repo migrations once and is idempotent', async () => {
    const first = await migrate(pool, repoMigrations)
    expect(first[0]).toBe('0001_init.sql')
    expect(await migrate(pool, repoMigrations)).toEqual([])
    expect((await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name)).toEqual(first)
    await pool.query("INSERT INTO rate_windows (bucket, reset_at) VALUES ('b', now())")
  })

  it('rolls back a failing file and applies files in name order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'))
    writeFileSync(join(dir, '0002_b.sql'), 'CREATE TABLE t_b (id int);')
    writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE t_a (id int);')
    writeFileSync(join(dir, '0003_bad.sql'), 'CREATE TABLE t_c (id int); SELECT nope();')
    await expect(migrate(pool, dir)).rejects.toThrow(/0003_bad.sql/)
    const names = (await pool.query('SELECT name FROM schema_migrations WHERE name = ANY($1) ORDER BY applied_at, name', [['0001_a.sql', '0002_b.sql', '0003_bad.sql']])).rows.map((r) => r.name)
    expect(names).toEqual(['0001_a.sql', '0002_b.sql'])
    expect((await pool.query("SELECT to_regclass('t_c') AS t")).rows[0].t).toBeNull()
  })
})
