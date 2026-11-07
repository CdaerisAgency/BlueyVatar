import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleRecord } from './handlers.js'
import { PgIndexWrites } from './pg-writes.js'

// Runs against a real Postgres when TEST_DATABASE_URL is set; each run uses a throwaway schema.
const url = process.env.TEST_DATABASE_URL
const migration = readFileSync(new URL('../../../db/migrations/0001_init.sql', import.meta.url), 'utf8')
const migrations = ['0002_web_auth', '0006_email_md5', '0010_email_ownership', '0013_notice_emails', '0014_gallery', '0019_notification_prefs', '0029_image_crop'].map((n) => readFileSync(new URL(`../../../db/migrations/${n}.sql`, import.meta.url), 'utf8'))
const schema = `t_indexer_${process.pid}_${Date.now()}`
const DID = 'did:plc:alice'

describe.skipIf(!url)('postgres index writes', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    await pool.query(migration)
    for (const m of migrations) await pool.query(m)
    await pool.query(readFileSync(new URL('../../../db/migrations/0009_profile_links.sql', import.meta.url), 'utf8'))
  })

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })

  it('upserts and deletes image records from Tap events', async () => {
    const purged: string[][] = []
    const db = new PgIndexWrites(pool, { onPurge: async (did, cids) => void purged.push([did, ...cids]) })
    const record = {
      image: { $type: 'blob', ref: { $link: 'bafyimg' }, mimeType: 'image/png', size: 10 },
      labels: { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'nudity' }] },
      isDefault: true,
      license: 'cc-by',
      createdAt: '2026-01-01T00:00:00Z',
    }
    await handleRecord({ did: DID, collection: 'com.blueyvatar.image', rkey: 'r1', action: 'create', record }, db)
    await handleRecord({ did: DID, collection: 'com.blueyvatar.image', rkey: 'r1', action: 'update', record: { ...record, isDefault: false } }, db)
    const { rows } = await pool.query('SELECT cid, mime_type, rating, is_default, license FROM images WHERE did = $1', [DID])
    expect(rows).toEqual([{ cid: 'bafyimg', mime_type: 'image/png', rating: 'pg', is_default: false, license: 'cc-by' }])
    await handleRecord({ did: DID, collection: 'com.blueyvatar.image', rkey: 'r1', action: 'delete' }, db)
    expect((await pool.query('SELECT 1 FROM images')).rowCount).toBe(0)
    expect(purged).toEqual([[DID, 'bafyimg']])
  })

  it('stores gallery fields and defaults existing rows to avatar', async () => {
    const db = new PgIndexWrites(pool)
    const image = { $type: 'blob', ref: { $link: 'bafygal1' }, mimeType: 'image/png', size: 10 }
    await handleRecord({ did: DID, collection: 'com.blueyvatar.image', rkey: 'g1', action: 'create', record: { image, purpose: 'gallery', caption: 'Beach', sort: 3, createdAt: '2026-01-01T00:00:00Z' } }, db)
    await handleRecord({ did: DID, collection: 'com.blueyvatar.image', rkey: 'a1', action: 'create', record: { image: { ...image, ref: { $link: 'bafyav1' } }, createdAt: '2026-01-02T00:00:00Z' } }, db)
    const { rows } = await pool.query('SELECT rkey, purpose, caption, sort FROM images WHERE did = $1 ORDER BY rkey', [DID])
    expect(rows).toEqual([
      { rkey: 'a1', purpose: 'avatar', caption: null, sort: null },
      { rkey: 'g1', purpose: 'gallery', caption: 'Beach', sort: 3 },
    ])
    await pool.query('DELETE FROM images WHERE did = $1', [DID])
  })

  it('stores crop parameters and ignores a malformed crop', async () => {
    const db = new PgIndexWrites(pool)
    const image = { $type: 'blob', ref: { $link: 'bafycrop1' }, mimeType: 'image/png', size: 10 }
    const put = (rkey: string, crop: unknown) =>
      handleRecord({ did: DID, collection: 'com.blueyvatar.image', rkey, action: 'create', record: { image, crop, createdAt: '2026-01-01T00:00:00Z' } }, db)
    await put('k1', { x: 1000, y: 0, size: 7500 })
    await put('k2', undefined)
    await put('k3', { x: 1000, y: 0, size: 2.5 })
    await put('k4', { x: -1, y: 0, size: 5000 })
    const { rows } = await pool.query('SELECT rkey, crop_x, crop_y, crop_size FROM images WHERE did = $1 ORDER BY rkey', [DID])
    expect(rows).toEqual([
      { rkey: 'k1', crop_x: 1000, crop_y: 0, crop_size: 7500 },
      { rkey: 'k2', crop_x: null, crop_y: null, crop_size: null },
      { rkey: 'k3', crop_x: null, crop_y: null, crop_size: null },
      { rkey: 'k4', crop_x: null, crop_y: null, crop_size: null },
    ])
    await pool.query('DELETE FROM images WHERE did = $1', [DID])
  })

  it('stores profiles, claims, and repo status', async () => {
    const db = new PgIndexWrites(pool)
    await db.upsertProfile(DID, { jobTitle: 'Engineer', backgroundColor: '#1f4e9b', createdAt: '2026-01-01T00:00:00Z' })
    await db.upsertClaim(DID, 'c1', { platform: 'github', uri: 'https://github.com/alice', createdAt: '2026-01-01T00:00:00Z' })
    await db.setRepoStatus(DID, 'alice.test', true)
    await db.setRepoStatus(DID, 'alice.test', false, 'takendown')
    expect((await pool.query('SELECT record FROM profiles')).rows[0].record.jobTitle).toBe('Engineer')
    expect((await pool.query('SELECT record FROM profiles')).rows[0].record.backgroundColor).toBe('#1f4e9b')
    expect((await pool.query('SELECT platform, uri FROM claims')).rows).toEqual([{ platform: 'github', uri: 'https://github.com/alice' }])
    expect((await pool.query('SELECT handle, active, status FROM repos')).rows).toEqual([{ handle: 'alice.test', active: false, status: 'takendown' }])
    await db.deleteProfile(DID)
    await db.deleteClaim(DID, 'c1')
    expect((await pool.query('SELECT 1 FROM profiles')).rowCount).toBe(0)
    expect((await pool.query('SELECT 1 FROM claims')).rowCount).toBe(0)
  })

  it('turns email links into 30-day holds when the account is deleted', async () => {
    const db = new PgIndexWrites(pool)
    await pool.query(`INSERT INTO email_links (email_hash, did, method, is_primary) VALUES ($1, $2, 'code', true), ($3, $2, 'code', false)`, ['1'.repeat(64), 'did:plc:gone', '2'.repeat(64)])
    await pool.query(`INSERT INTO notice_emails (did, email_hash, email_enc) VALUES ($1, $2, 'v1:a:b:c')`, ['did:plc:gone', '1'.repeat(64)])
    await db.setRepoStatus('did:plc:gone', null, false, 'takendown')
    expect((await pool.query('SELECT 1 FROM notice_emails')).rowCount).toBe(1)
    expect((await pool.query('SELECT 1 FROM email_links WHERE did = $1', ['did:plc:gone'])).rowCount).toBe(2)
    await db.setRepoStatus('did:plc:gone', null, false, 'deleted')
    expect((await pool.query('SELECT 1 FROM email_links WHERE did = $1', ['did:plc:gone'])).rowCount).toBe(0)
    expect((await pool.query('SELECT 1 FROM notice_emails')).rowCount).toBe(0)
    expect((await pool.query('SELECT reason FROM email_holds WHERE did = $1', ['did:plc:gone'])).rows).toEqual([{ reason: 'account_deleted' }, { reason: 'account_deleted' }])
  })

  it('upserts link records by did and rkey and deletes them', async () => {
    const db = new PgIndexWrites(pool)
    const evt = { did: DID, collection: 'app.bsky.actor.link', rkey: 'l1', action: 'create' as const }
    await handleRecord({ ...evt, cid: 'bafy1', record: { url: 'https://a.test/', title: 'A', createdAt: '2026-01-01T00:00:00Z' } }, db)
    await handleRecord({ ...evt, action: 'update', cid: 'bafy2', record: { url: 'https://b.test/', createdAt: '2026-01-01T00:00:00Z' } }, db)
    expect((await pool.query('SELECT cid, url, title FROM profile_links')).rows).toEqual([{ cid: 'bafy2', url: 'https://b.test/', title: null }])
    await handleRecord({ ...evt, action: 'delete' }, db)
    expect((await pool.query('SELECT 1 FROM profile_links')).rowCount).toBe(0)
  })
})
