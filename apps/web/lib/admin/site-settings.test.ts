import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import pg from 'pg'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@blueyvatar/core/settings'
import { getAssetMeta, listSettingRows, putOverLimitAsset, removeOverLimitAsset, resetSetting, saveSettings } from './site-settings'

type Call = { sql: string; params: unknown[] }

/** A fake pool: records every query made through its one client and answers from `answer`. */
function fakePool(answer: (sql: string, params: unknown[]) => { rows: unknown[] } = () => ({ rows: [] })) {
  const withId = (sql: string, params: unknown[]) => (sql.includes('INSERT INTO admin_actions') ? { rows: [{ id: 1 }] } : answer(sql, params))
  const calls: Call[] = []
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      return withId(sql, params)
    }),
    release: vi.fn(),
  }
  const pool = { connect: vi.fn(async () => client), query: client.query } as unknown as pg.Pool
  return { pool, calls, client }
}

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#3366cc' } }).png().toBuffer()

describe('site settings store (no database)', () => {
  it('listSettingRows returns [] when the table is missing', async () => {
    const q = { query: vi.fn().mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' })) }
    expect(await listSettingRows(q)).toEqual([])
  })

  it('listSettingRows rethrows other errors', async () => {
    const q = { query: vi.fn().mockRejectedValue(Object.assign(new Error('boom'), { code: '08006' })) }
    await expect(listSettingRows(q)).rejects.toThrow('boom')
  })

  it('getAssetMeta returns null when the table is missing', async () => {
    const q = { query: vi.fn().mockRejectedValue({ code: '42P01' }) }
    expect(await getAssetMeta(q, 'over_limit_avatar')).toBeNull()
  })

  it('writes nothing when any value is invalid', async () => {
    const { pool, calls } = fakePool()
    const r = await saveSettings(pool, 'did:plc:admin', [
      { key: 'limits.anonymousDaily', value: 500 },
      { key: 'sizes.free.maxSize', value: 99999 },
      { key: 'nope', value: 1 },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['nope', 'sizes.free.maxSize'])
    expect(calls).toEqual([])
  })

  it('rejects non-image and oversize input; stores a square PNG', async () => {
    const bad = fakePool()
    expect(await putOverLimitAsset(bad.pool, 'a', Buffer.from('not an image'))).toEqual({ ok: false, error: expect.any(String) })
    expect(await putOverLimitAsset(bad.pool, 'a', Buffer.alloc(2 * 1024 * 1024 + 1))).toEqual({ ok: false, error: expect.any(String) })
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).gif().toBuffer()
    expect(await putOverLimitAsset(bad.pool, 'a', gif)).toEqual({ ok: false, error: expect.any(String) })
    expect(bad.calls).toEqual([])

    const { pool, calls } = fakePool()
    expect(await putOverLimitAsset(pool, 'did:plc:admin', await png(300, 200))).toEqual({ ok: true })
    const upsert = calls.find((c) => c.sql.includes('INSERT INTO site_assets'))!
    const [name, image, mime, width, height, sha, actor] = upsert.params as [string, Buffer, string, number, number, string, string]
    expect([name, mime, width, height, actor]).toEqual(['over_limit_avatar', 'image/png', 200, 200, 'did:plc:admin'])
    expect(sha).toBe(createHash('sha256').update(image).digest('hex'))
    const meta = await sharp(image).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 200, 200])
    const audit = calls.find((c) => c.sql.includes('INSERT INTO admin_actions'))!
    expect(audit.params[1]).toBe('asset_change')
    expect(JSON.parse(audit.params[8] as string)).toEqual({ name: 'over_limit_avatar', before: null, after: sha })
    expect(calls[0]!.sql).toBe('BEGIN')
    expect(calls.at(-1)!.sql).toBe('COMMIT')
  })

  it('caps the edge at 1024', async () => {
    const { pool, calls } = fakePool()
    await putOverLimitAsset(pool, 'a', await png(1500, 1300))
    const p = calls.find((c) => c.sql.includes('INSERT INTO site_assets'))!.params
    expect([p[3], p[4]]).toEqual([1024, 1024])
  })

  it('removeOverLimitAsset deletes and audits the old hash', async () => {
    const { pool, calls } = fakePool((sql) => (sql.includes('SELECT sha256') ? { rows: [{ sha256: 'abc' }] } : { rows: [] }))
    await removeOverLimitAsset(pool, 'did:plc:admin')
    expect(calls.some((c) => c.sql.includes('DELETE FROM site_assets'))).toBe(true)
    const audit = calls.find((c) => c.sql.includes('INSERT INTO admin_actions'))!
    expect(JSON.parse(audit.params[8] as string)).toEqual({ name: 'over_limit_avatar', before: 'abc', after: null })
  })
})

const url = process.env.TEST_DATABASE_URL
const schema = `t_site_settings_${process.pid}_${Date.now()}`
const sql = (f: string) => readFileSync(new URL(`../../../../db/migrations/${f}`, import.meta.url), 'utf8')
const ADMIN = 'did:plc:settingsadmin'

describe.skipIf(!url)('site settings store (postgres)', () => {
  let pool: pg.Pool
  const audits = async () =>
    (await pool.query("SELECT actor, detail FROM admin_actions WHERE action = 'settings_change' ORDER BY id")).rows as { actor: string; detail: { key: string; before: unknown; after: unknown } }[]

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    for (const f of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter((x) => x.endsWith('.sql')).sort()) await pool.query(sql(f))
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })

  it('saves changed keys and audits each', async () => {
    const r = await saveSettings(pool, ADMIN, [
      { key: 'limits.anonymousDaily', value: 500 },
      { key: 'embeds.profileAccess', value: { anonymous: true, free: false, plus: true, business: true } },
    ])
    expect(r).toEqual({ ok: true, changed: ['limits.anonymousDaily', 'embeds.profileAccess'] })
    const rows = await listSettingRows(pool)
    expect(rows.find((x) => x.key === 'limits.anonymousDaily')?.value).toBe(500)
    const log = await audits()
    expect(log).toHaveLength(2)
    expect(log[0]).toEqual({ actor: ADMIN, detail: { key: 'limits.anonymousDaily', before: DEFAULT_SETTINGS.anonymousDaily, after: 500 } })
    expect((await pool.query("SELECT updated_by FROM site_settings WHERE key = 'limits.anonymousDaily'")).rows[0].updated_by).toBe(ADMIN)
  })

  it('writes nothing when any value is invalid', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM admin_actions')).rows[0].n
    const r = await saveSettings(pool, ADMIN, [{ key: 'limits.free.keyedDaily', value: 5000 }, { key: 'sizes.free.maxSize', value: 1 }])
    expect(r.ok).toBe(false)
    expect((await pool.query("SELECT 1 FROM site_settings WHERE key = 'limits.free.keyedDaily'")).rowCount).toBe(0)
    expect((await pool.query('SELECT count(*)::int AS n FROM admin_actions')).rows[0].n).toBe(before)
  })

  it('skips unchanged values', async () => {
    const before = (await audits()).length
    const r = await saveSettings(pool, ADMIN, [
      { key: 'limits.anonymousDaily', value: 500 },
      { key: 'embeds.profileAccess', value: { business: true, plus: true, free: false, anonymous: true } },
      { key: 'sizes.plus.maxSize', value: DEFAULT_SETTINGS.maxSize.plus },
    ])
    expect(r).toEqual({ ok: true, changed: [] })
    expect((await audits()).length).toBe(before)
  })

  it('reset deletes the row and audits', async () => {
    await resetSetting(pool, ADMIN, 'limits.anonymousDaily')
    expect((await pool.query("SELECT 1 FROM site_settings WHERE key = 'limits.anonymousDaily'")).rowCount).toBe(0)
    const last = (await audits()).at(-1)!
    expect(last.detail).toEqual({ key: 'limits.anonymousDaily', before: 500, after: 'default' })
  })

  it('stores, reads, and removes the over-limit asset with audit', async () => {
    expect(await getAssetMeta(pool, 'over_limit_avatar')).toBeNull()
    expect(await putOverLimitAsset(pool, ADMIN, await png(64, 64))).toEqual({ ok: true })
    const meta = await getAssetMeta(pool, 'over_limit_avatar')
    expect(meta).toMatchObject({ width: 64, height: 64, mime: 'image/png' })
    await removeOverLimitAsset(pool, ADMIN)
    expect(await getAssetMeta(pool, 'over_limit_avatar')).toBeNull()
    expect((await pool.query("SELECT count(*)::int AS n FROM admin_actions WHERE action = 'asset_change'")).rows[0].n).toBe(2)
  })
})
