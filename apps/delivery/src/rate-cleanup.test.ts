import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupRateWindows } from './rate-cleanup.js'

// Runs against a real Postgres when TEST_DATABASE_URL is set; each run uses a throwaway schema.
const url = process.env.TEST_DATABASE_URL
const migration = readFileSync(new URL('../../../db/migrations/0001_init.sql', import.meta.url), 'utf8')
const schema = `t_cleanup_${process.pid}_${Date.now()}`

describe.skipIf(!url)('rate window cleanup', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    await pool.query(migration)
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })

  it('removes only expired rows', async () => {
    await pool.query("INSERT INTO rate_windows (bucket, count, reset_at) VALUES ('old', 3, now() - interval '1 minute'), ('live', 1, now() + interval '1 minute')")
    expect(await cleanupRateWindows(pool)).toBe(1)
    expect((await pool.query('SELECT bucket FROM rate_windows')).rows).toEqual([{ bucket: 'live' }])
  })
})
