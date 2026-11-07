import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { blockImage, unblockImage } from './ops-block.js'

const url = process.env.TEST_DATABASE_URL
const sql = (f: string) => readFileSync(new URL(`../../../db/migrations/${f}`, import.meta.url), 'utf8')
const schema = `t_block_${process.pid}_${Date.now()}`
const DID = 'did:plc:alice'

describe.skipIf(!url)('operator block and unblock', () => {
  let pool: pg.Pool
  const active = async () =>
    (await pool.query('SELECT 1 FROM blocked_images WHERE did = $1 AND cid = $2 AND unblocked_at IS NULL', [DID, 'bafyone'])).rowCount
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    await pool.query(sql('0001_init.sql'))
    await pool.query(sql('0008_blocked_images.sql'))
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })

  it('writes the row, then purges the image', async () => {
    const purge = vi.fn(async () => { expect(await active()).toBe(1) })
    await blockImage(pool, purge, DID, 'bafyone', 'abuse report', 'ops')
    expect(purge).toHaveBeenCalledWith(DID, ['bafyone'])
    const { rows } = await pool.query('SELECT reason, blocked_by FROM blocked_images WHERE did = $1', [DID])
    expect(rows).toEqual([{ reason: 'abuse report', blocked_by: 'ops' }])
  })

  it('unblocks and purges, and reports when nothing was blocked', async () => {
    const purge = vi.fn(async () => {})
    expect(await unblockImage(pool, purge, DID, 'bafyone')).toBe(true)
    expect(await active()).toBe(0)
    expect(purge).toHaveBeenCalledOnce()
    expect(await unblockImage(pool, purge, DID, 'bafyone')).toBe(false)
    expect(purge).toHaveBeenCalledOnce()
    await blockImage(pool, purge, DID, 'bafyone', 'again', 'ops')
    expect(await active()).toBe(1)
  })
})
