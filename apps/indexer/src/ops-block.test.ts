import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { blockDid, blockImage, unblockImage } from './ops-block.js'

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
    await pool.query(sql('0012_reports.sql'))
    await pool.query(sql('0019_admin.sql'))
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

  it('audits block and unblock', async () => {
    const log = await pool.query('SELECT actor, action, target_cid FROM admin_actions WHERE target_did = $1 ORDER BY id', [DID])
    expect(log.rows).toEqual([{ actor: 'ops', action: 'block_image', target_cid: 'bafyone' }])
  })

  it('unblocks and purges, and reports when nothing was blocked', async () => {
    const purge = vi.fn(async () => {})
    expect(await unblockImage(pool, purge, DID, 'bafyone', 'ops')).toBe(true)
    expect((await pool.query("SELECT 1 FROM admin_actions WHERE action = 'unblock_image' AND actor = 'ops'")).rowCount).toBe(1)
    expect(await active()).toBe(0)
    expect(purge).toHaveBeenCalledOnce()
    expect(await unblockImage(pool, purge, DID, 'bafyone')).toBe(false)
    expect(purge).toHaveBeenCalledOnce()
    await blockImage(pool, purge, DID, 'bafyone', 'again', 'ops')
    expect(await active()).toBe(1)
  })

  it('blocks every image of a reported DID and records who and why on the report', async () => {
    const did = 'did:plc:reported'
    for (const [rkey, cid] of [['a', 'bafya'], ['b', 'bafyb']])
      await pool.query(`INSERT INTO images (did, rkey, cid, mime_type, rating, created_at) VALUES ($1, $2, $3, 'image/png', 'g', now())`, [did, rkey, cid])
    const { rows } = await pool.query(`INSERT INTO reports (target_did, source, reason, ip_hash) VALUES ($1, 'profile', 'illegal', 'h') RETURNING id`, [did])
    const purge = vi.fn(async () => {})
    expect((await blockDid(pool, purge, did, 'policy', 'ops', Number(rows[0].id))).sort()).toEqual(['bafya', 'bafyb'])
    expect(purge).toHaveBeenCalledTimes(2)
    const r = await pool.query('SELECT status, actioned_by, action_reason FROM reports WHERE id = $1', [rows[0].id])
    expect(r.rows[0]).toEqual({ status: 'actioned', actioned_by: 'ops', action_reason: 'policy' })
    expect((await pool.query('SELECT 1 FROM blocked_images WHERE did = $1 AND unblocked_at IS NULL', [did])).rowCount).toBe(2)
    expect((await pool.query('SELECT kind FROM blocked_images WHERE did = $1', [did])).rows.every((r) => r.kind === 'takedown')).toBe(true)
    const log = await pool.query('SELECT actor, action, report_id::int AS report_id, reason FROM admin_actions WHERE target_did = $1', [did])
    expect(log.rows).toEqual([{ actor: 'ops', action: 'takedown', report_id: Number(rows[0].id), reason: 'policy' }])
  })
})
