import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { purgeExpiredScreenshots } from './bug-report-retention.js'

const url = process.env.TEST_DATABASE_URL
const schema = `t_shotret_${process.pid}_${Date.now()}`
const NOW = new Date('2026-12-01T00:00:00Z')

describe.skipIf(!url)('bug report screenshot purge', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    await pool.query(readFileSync(new URL('../../../db/migrations/0040_bug_report_screenshots.sql', import.meta.url), 'utf8'))
    await pool.query(
      `INSERT INTO bug_report_screenshots (id, did, image, created_at) VALUES
        ('old', 'did:plc:a', 'x', '2026-08-31T00:00:00Z'),
        ('edge', 'did:plc:a', 'x', '2026-09-02T00:00:00Z'),
        ('new', 'did:plc:b', 'x', '2026-11-30T00:00:00Z')`,
    )
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })

  it('deletes screenshots older than 90 days and keeps the rest', async () => {
    expect(await purgeExpiredScreenshots(pool, NOW)).toBe(1)
    const left = (await pool.query('SELECT id FROM bug_report_screenshots ORDER BY id')).rows.map((r) => r.id)
    expect(left).toEqual(['edge', 'new'])
    expect(await purgeExpiredScreenshots(pool, NOW)).toBe(0)
  })
})
