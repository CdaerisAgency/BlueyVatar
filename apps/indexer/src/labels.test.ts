import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PgLabelStore, labelerDidsFromEnv, runLabeler, type Label, type LabelFrame, type LabelStore } from './labels.js'

const SRC = 'did:plc:labeler'
const lab = (o: Partial<Label>): Label => ({ src: SRC, uri: 'did:plc:alice', val: '!takedown', cts: '2026-11-07T00:00:00Z', ...o })

describe('runLabeler with a fake label stream', () => {
  it('resumes from the stored cursor, applies frames, and reconnects after a drop', async () => {
    let cursor = 0
    const applied: number[] = []
    const store: LabelStore = {
      getCursor: async () => cursor,
      applyFrame: async (_s, f) => { applied.push(f.seq); cursor = f.seq; return { stored: 1, removed: 0, queued: 0 } },
    }
    const cursorsSeen: number[] = []
    let stop = false
    const source = (c: number) => {
      cursorsSeen.push(c)
      const attempt = cursorsSeen.length
      return (async function* () {
        if (attempt === 1) { yield { seq: 1, labels: [] } as LabelFrame; yield { seq: 2, labels: [] } as LabelFrame; throw new Error('dropped') }
        yield { seq: 3, labels: [] } as LabelFrame
        stop = true
      })()
    }
    await runLabeler(SRC, source, store, { stopped: () => stop, sleep: async () => {} })
    expect(applied).toEqual([1, 2, 3])
    expect(cursorsSeen).toEqual([0, 2])
  })
})

describe('labelerDidsFromEnv', () => {
  it('keeps DIDs only', () => {
    expect(labelerDidsFromEnv({ LABELER_DIDS: 'did:plc:a, did:web:b.test nope did:plc:a' })).toEqual(['did:plc:a', 'did:web:b.test'])
    expect(labelerDidsFromEnv({})).toEqual([])
  })
})

const url = process.env.TEST_DATABASE_URL
const schema = `t_labels_${process.pid}_${Date.now()}`
const sql = (n: string) => readFileSync(new URL(`../../../db/migrations/${n}.sql`, import.meta.url), 'utf8')

describe.skipIf(!url)('PgLabelStore', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    for (const m of ['0001_init', '0012_reports', '0014_gallery', '0029_image_crop', '0030_screening_labels']) await pool.query(sql(m))
  })
  afterAll(async () => { await pool?.query(`DROP SCHEMA ${schema} CASCADE`); await pool?.end() })

  it('stores enforced labels, queues one review item, persists the cursor, and handles negation', async () => {
    const purged: string[] = []
    const store = new PgLabelStore(pool, { onRemoved: async (did) => void purged.push(did) })
    const frame: LabelFrame = { seq: 5, labels: [lab({}), lab({ val: 'bot' }), lab({ src: 'did:plc:other' }), lab({ uri: 'at://did:plc:alice/com.blueyvatar.image/1', val: 'porn' })] }
    expect(await store.applyFrame(SRC, frame)).toEqual({ stored: 2, removed: 1, queued: 2 })
    expect(await store.applyFrame(SRC, { seq: 6, labels: [lab({})] })).toMatchObject({ queued: 0 })
    expect(await store.getCursor(SRC)).toBe(6)
    const { rows } = await pool.query("SELECT reason, origin FROM reports ORDER BY reason")
    expect(rows).toEqual([{ reason: 'explicit', origin: 'label' }, { reason: 'other', origin: 'label' }])
    expect(purged).toEqual(['did:plc:alice'])
    await store.applyFrame(SRC, { seq: 7, labels: [lab({ neg: true })] })
    const left = await pool.query('SELECT val FROM moderation_labels')
    expect(left.rows).toEqual([{ val: 'porn' }])
  })
})
