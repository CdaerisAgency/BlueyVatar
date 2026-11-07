import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleRecord } from './handlers.js'
import { PgIndexWrites } from './pg-writes.js'

// Runs against a real Postgres when TEST_DATABASE_URL is set; each run uses a throwaway schema.
const url = process.env.TEST_DATABASE_URL
const migration = readFileSync(new URL('../../../db/migrations/0001_init.sql', import.meta.url), 'utf8')
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
    await pool.query(readFileSync(new URL('../../../db/migrations/0007_profile_links.sql', import.meta.url), 'utf8'))
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

  it('stores profiles, claims, and repo status', async () => {
    const db = new PgIndexWrites(pool)
    await db.upsertProfile(DID, { jobTitle: 'Engineer', createdAt: '2026-01-01T00:00:00Z' })
    await db.upsertClaim(DID, 'c1', { platform: 'github', uri: 'https://github.com/alice', createdAt: '2026-01-01T00:00:00Z' })
    await db.setRepoStatus(DID, 'alice.test', true)
    await db.setRepoStatus(DID, 'alice.test', false, 'takendown')
    expect((await pool.query('SELECT record FROM profiles')).rows[0].record.jobTitle).toBe('Engineer')
    expect((await pool.query('SELECT platform, uri FROM claims')).rows).toEqual([{ platform: 'github', uri: 'https://github.com/alice' }])
    expect((await pool.query('SELECT handle, active, status FROM repos')).rows).toEqual([{ handle: 'alice.test', active: false, status: 'takendown' }])
    await db.deleteProfile(DID)
    await db.deleteClaim(DID, 'c1')
    expect((await pool.query('SELECT 1 FROM profiles')).rowCount).toBe(0)
    expect((await pool.query('SELECT 1 FROM claims')).rowCount).toBe(0)
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
