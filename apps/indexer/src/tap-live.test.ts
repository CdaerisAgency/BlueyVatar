import { readdirSync, readFileSync } from 'node:fs'
import { Tap, type TapEvent, type TapHandler } from '@atproto/tap'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveProfileLinks } from '@blueyvatar/core'
import { COLLECTIONS, handleRecord } from './handlers.js'
import { PgIndexWrites } from './pg-writes.js'

/**
 * Live integration test for the indexer against a real Tap instance (issue #42).
 *
 * It signs in to a dedicated test account on a PDS, writes records in all seven collections that
 * Tap filters on, consumes the resulting events through the same `@atproto/tap` channel the indexer
 * uses, runs them through `handleRecord` and `PgIndexWrites` into a throwaway Postgres schema, and
 * asserts the rows. It also checks that the Tap event `cid` is the record CID (issue #101: profile
 * links are dropped when the strongRef cid differs from the indexed cid) and that every event is
 * acknowledged only after its handler finished.
 *
 * Skipped unless every required variable is set. See docs/deploy.md, "Live Tap test".
 *
 *   TAP_LIVE_URL            Tap base URL, for example http://localhost:2480
 *   TAP_LIVE_ADMIN_PASSWORD Tap admin password (falls back to TAP_ADMIN_PASSWORD; omit when Tap has none)
 *   TAP_LIVE_PDS_URL        PDS of the test account (default https://bsky.social)
 *   TAP_LIVE_IDENTIFIER     test account handle or DID
 *   TAP_LIVE_APP_PASSWORD   app password for the test account
 *   TEST_DATABASE_URL       Postgres for the throwaway schema
 *   TAP_LIVE_TIMEOUT_MS     per-wait timeout (default 90000)
 *   TAP_LIVE_CHECK_STATUS=1 also deactivate and reactivate the account to check `repos` status updates
 */
const env = process.env
const tapUrl = env.TAP_LIVE_URL
const adminPassword = env.TAP_LIVE_ADMIN_PASSWORD ?? env.TAP_ADMIN_PASSWORD
const pdsUrl = (env.TAP_LIVE_PDS_URL ?? 'https://bsky.social').replace(/\/+$/, '')
const identifier = env.TAP_LIVE_IDENTIFIER
const appPassword = env.TAP_LIVE_APP_PASSWORD
const dbUrl = env.TEST_DATABASE_URL
const waitMs = Number(env.TAP_LIVE_TIMEOUT_MS ?? 90_000)
const checkStatus = env.TAP_LIVE_CHECK_STATUS === '1'

const missing = [
  ['TAP_LIVE_URL', tapUrl],
  ['TAP_LIVE_IDENTIFIER', identifier],
  ['TAP_LIVE_APP_PASSWORD', appPassword],
  ['TEST_DATABASE_URL', dbUrl],
]
  .filter(([, v]) => !v)
  .map(([k]) => k)
const enabled = missing.length === 0
if (!enabled) {
  console.info(`[tap-live] skipped: set ${missing.join(', ')} to run the live Tap test (see docs/deploy.md, "Live Tap test").`)
}

const schema = `t_taplive_${process.pid}_${Date.now()}`
const migrationsDir = new URL('../../../db/migrations/', import.meta.url)
const run = Date.now().toString(36)
// 1x1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

interface Seen {
  evt: TapEvent
  /** Order of "handled" and "acked" marks, to prove ack follows the handler. */
  marks: string[]
}

describe.skipIf(!enabled)('indexer against a live Tap', () => {
  let pool: pg.Pool
  let tap: Tap
  let did = ''
  let jwt = ''
  let channelError: unknown
  let destroy: (() => Promise<void>) | undefined
  const seen: Seen[] = []
  const log: string[] = []
  const created: { collection: string; rkey: string }[] = []

  async function xrpc<T = Record<string, unknown>>(nsid: string, body: unknown, opts: { raw?: Buffer; type?: string } = {}): Promise<T> {
    const res = await fetch(`${pdsUrl}/xrpc/${nsid}`, {
      method: 'POST',
      headers: { 'content-type': opts.type ?? 'application/json', ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
      body: opts.raw ?? JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${nsid} failed: ${res.status} ${text}`)
    return (text ? JSON.parse(text) : {}) as T
  }

  async function putRecord(collection: string, rkey: string, record: Record<string, unknown>): Promise<string> {
    const out = await xrpc<{ cid: string }>('com.atproto.repo.putRecord', { repo: did, collection, rkey, record: { $type: collection, ...record }, validate: false })
    if (!created.some((c) => c.collection === collection && c.rkey === rkey)) created.push({ collection, rkey })
    return out.cid
  }

  async function deleteRecord(collection: string, rkey: string): Promise<void> {
    await xrpc('com.atproto.repo.deleteRecord', { repo: did, collection, rkey })
  }

  async function waitFor<T>(what: string, probe: () => Promise<T | undefined | false> | T | undefined | false): Promise<T> {
    const deadline = Date.now() + waitMs
    for (;;) {
      if (channelError) throw new Error(`Tap channel failed while waiting for ${what}: ${String(channelError)}`)
      const v = await probe()
      if (v) return v
      if (Date.now() > deadline) throw new Error(`timed out after ${waitMs} ms waiting for ${what}. Events seen for the test DID: ${JSON.stringify(seen.filter((s) => (s.evt as { did: string }).did === did).map((s) => s.evt.type === 'record' ? `${s.evt.action} ${s.evt.collection}/${s.evt.rkey}` : `identity ${s.evt.status}`))}`)
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  const q = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> => (await pool.query<T>(sql, params)).rows
  const recordEvents = (collection: string, rkey: string, action?: string) =>
    seen.filter((s) => s.evt.type === 'record' && s.evt.did === did && s.evt.collection === collection && s.evt.rkey === rkey && (!action || s.evt.action === action))

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: dbUrl })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: dbUrl, options: `-c search_path=${schema}` })
    for (const f of readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort()) {
      await pool.query(readFileSync(new URL(f, migrationsDir), 'utf8'))
    }

    const session = await xrpc<{ accessJwt: string; did: string }>('com.atproto.server.createSession', { identifier, password: appPassword })
    jwt = session.accessJwt
    did = session.did

    const db = new PgIndexWrites(pool)
    tap = new Tap(tapUrl!, { adminPassword })
    // Same wiring as src/index.ts, plus marks that record the handler and ack order.
    const handler: TapHandler = {
      onEvent: async (evt, { ack }) => {
        const entry: Seen = { evt, marks: [] }
        seen.push(entry)
        if (evt.type === 'record') {
          await handleRecord({ did: evt.did, collection: evt.collection, rkey: evt.rkey, cid: evt.cid, action: evt.action, record: evt.record as Record<string, unknown> | undefined }, db)
        } else {
          await db.setRepoStatus(evt.did, evt.handle, evt.isActive, evt.status)
        }
        entry.marks.push('handled')
        await ack()
        entry.marks.push('acked')
      },
      onError: (err) => void log.push(`tap error: ${err.message}`),
    }
    const channel = tap.channel(handler)
    destroy = () => channel.destroy()
    channel.start().catch((err) => {
      channelError = err
    })
  })

  afterAll(async () => {
    // Best-effort cleanup of the test account's records, then the throwaway schema.
    for (const c of [...created].reverse()) {
      if (c.collection === COLLECTIONS.bskyProfile) continue
      await deleteRecord(c.collection, c.rkey).catch(() => undefined)
    }
    await destroy?.().catch(() => undefined)
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })

  it('indexes create, update and delete across all seven collections with correct CIDs', async () => {
    const now = new Date().toISOString()
    const imageRkey = `img${run}`
    const linkRkey = `lnk${run}`
    const claimRkey = `clm${run}`

    // The profile record is Tap's signal collection, so writing it makes Tap track the repo.
    // addRepos makes the start deterministic when Tap already knows the repo.
    const profileCid = await putRecord(COLLECTIONS.profile, 'self', { jobTitle: 'Tap live test', timezone: 'UTC', interests: ['tap'], createdAt: now })
    await tap.addRepos([did])

    const blob = (await xrpc<{ blob: Record<string, unknown> & { ref: { $link: string } } }>('com.atproto.repo.uploadBlob', undefined, { raw: PNG, type: 'image/png' })).blob
    const imageRecord = { image: blob, isDefault: true, license: 'cc-by', createdAt: now }
    const imageCid1 = await putRecord(COLLECTIONS.image, imageRkey, imageRecord)
    const linkCid1 = await putRecord(COLLECTIONS.bskyLink, linkRkey, { url: 'https://example.com/tap-live', title: 'First', createdAt: now })
    const claimCid1 = await putRecord(COLLECTIONS.claim, claimRkey, { platform: 'github', uri: 'https://github.com/tap-live-test', createdAt: now })
    const tangledCid = await putRecord(COLLECTIONS.tangledProfile, 'self', { description: 'Tap live test', links: [], stats: [], pinnedRepositories: [] })
    const tangledLegacyCid = await putRecord(COLLECTIONS.tangledLegacyProfile, 'self', { description: 'Tap live test', links: [], stats: [], pinnedRepositories: [] })
    const linkRef = { uri: `at://${did}/${COLLECTIONS.bskyLink}/${linkRkey}`, cid: linkCid1 }
    const bskyCid = await putRecord(COLLECTIONS.bskyProfile, 'self', { displayName: 'Tap live test', links: [linkRef] })

    // Creates: rows exist.
    await waitFor('image, profile, claim and link rows', async () => {
      const [i, p, c, l] = await Promise.all([
        q('SELECT 1 FROM images WHERE did = $1 AND rkey = $2', [did, imageRkey]),
        q('SELECT 1 FROM profiles WHERE did = $1', [did]),
        q('SELECT 1 FROM claims WHERE did = $1 AND rkey = $2', [did, claimRkey]),
        q('SELECT 1 FROM profile_links WHERE did = $1 AND rkey = $2', [did, linkRkey]),
      ])
      return i.length && p.length && c.length && l.length
    })
    const [image] = await q('SELECT cid, mime_type, is_default, license FROM images WHERE did = $1 AND rkey = $2', [did, imageRkey])
    expect(image).toEqual({ cid: blob.ref.$link, mime_type: 'image/png', is_default: true, license: 'cc-by' })
    const [claim] = await q('SELECT platform, uri FROM claims WHERE did = $1 AND rkey = $2', [did, claimRkey])
    expect(claim).toEqual({ platform: 'github', uri: 'https://github.com/tap-live-test' })
    expect((await q<{ record: { jobTitle: string } }>('SELECT record FROM profiles WHERE did = $1', [did]))[0]?.record.jobTitle).toBe('Tap live test')

    // The Tap event cid is the record CID (issue #101 and #42). Checked on the raw events for every
    // collection, which covers the Tangled profile records that the indexer does not store.
    await waitFor('create events for every collection', () =>
      [
        [COLLECTIONS.profile, 'self'],
        [COLLECTIONS.image, imageRkey],
        [COLLECTIONS.bskyLink, linkRkey],
        [COLLECTIONS.claim, claimRkey],
        [COLLECTIONS.tangledProfile, 'self'],
        [COLLECTIONS.tangledLegacyProfile, 'self'],
        [COLLECTIONS.bskyProfile, 'self'],
      ].every(([c, r]) => recordEvents(c!, r!).length > 0),
    )
    const cidOf = (collection: string, rkey: string) => {
      const last = recordEvents(collection, rkey).at(-1)?.evt
      return last?.type === 'record' ? last.cid : undefined
    }
    expect(cidOf(COLLECTIONS.profile, 'self'), 'com.blueyvatar.profile event cid').toBe(profileCid)
    expect(cidOf(COLLECTIONS.image, imageRkey), 'com.blueyvatar.image event cid').toBe(imageCid1)
    expect(cidOf(COLLECTIONS.claim, claimRkey), 'com.blueyvatar.claim event cid').toBe(claimCid1)
    expect(cidOf(COLLECTIONS.bskyLink, linkRkey), 'app.bsky.actor.link event cid').toBe(linkCid1)
    expect(cidOf(COLLECTIONS.tangledProfile, 'self'), 'org.tangled.actor.profile event cid').toBe(tangledCid)
    expect(cidOf(COLLECTIONS.tangledLegacyProfile, 'self'), 'sh.tangled.actor.profile event cid').toBe(tangledLegacyCid)
    expect(cidOf(COLLECTIONS.bskyProfile, 'self'), 'app.bsky.actor.profile event cid').toBe(bskyCid)

    // The stored link cid is the record CID, so the strongRef in the profile resolves and is not dropped.
    const [stored] = await q<{ rkey: string; cid: string; url: string; title: string | null }>('SELECT rkey, cid, url, title FROM profile_links WHERE did = $1 AND rkey = $2', [did, linkRkey])
    expect(stored?.cid).toBe(linkCid1)
    expect(resolveProfileLinks(did, [linkRef], [stored!])).toEqual([{ url: 'https://example.com/tap-live', title: 'First' }])

    // Updates: new cid and fields.
    const linkCid2 = await putRecord(COLLECTIONS.bskyLink, linkRkey, { url: 'https://example.com/tap-live', title: 'Second', createdAt: now })
    expect(linkCid2).not.toBe(linkCid1)
    await putRecord(COLLECTIONS.image, imageRkey, { ...imageRecord, isDefault: false })
    await putRecord(COLLECTIONS.claim, claimRkey, { platform: 'github', uri: 'https://github.com/tap-live-test-2', createdAt: now })
    await waitFor('updated rows', async () => {
      const [l] = await q<{ cid: string; title: string }>('SELECT cid, title FROM profile_links WHERE did = $1 AND rkey = $2', [did, linkRkey])
      const [i] = await q<{ is_default: boolean }>('SELECT is_default FROM images WHERE did = $1 AND rkey = $2', [did, imageRkey])
      const [c] = await q<{ uri: string }>('SELECT uri FROM claims WHERE did = $1 AND rkey = $2', [did, claimRkey])
      return l?.cid === linkCid2 && l.title === 'Second' && i?.is_default === false && c?.uri.endsWith('-2')
    })
    // The old strongRef no longer resolves, which is the behavior #101 relies on.
    const [updated] = await q<{ rkey: string; cid: string; url: string; title: string | null }>('SELECT rkey, cid, url, title FROM profile_links WHERE did = $1 AND rkey = $2', [did, linkRkey])
    expect(resolveProfileLinks(did, [linkRef], [updated!])).toEqual([])
    expect(resolveProfileLinks(did, [{ ...linkRef, cid: linkCid2 }], [updated!])).toEqual([{ url: 'https://example.com/tap-live', title: 'Second' }])

    // Deletes: rows disappear.
    await deleteRecord(COLLECTIONS.image, imageRkey)
    await deleteRecord(COLLECTIONS.bskyLink, linkRkey)
    await deleteRecord(COLLECTIONS.claim, claimRkey)
    await deleteRecord(COLLECTIONS.profile, 'self')
    await deleteRecord(COLLECTIONS.tangledProfile, 'self')
    await deleteRecord(COLLECTIONS.tangledLegacyProfile, 'self')
    await waitFor('deleted rows', async () => {
      const gone = await Promise.all([
        q('SELECT 1 FROM images WHERE did = $1 AND rkey = $2', [did, imageRkey]),
        q('SELECT 1 FROM profile_links WHERE did = $1 AND rkey = $2', [did, linkRkey]),
        q('SELECT 1 FROM claims WHERE did = $1 AND rkey = $2', [did, claimRkey]),
        q('SELECT 1 FROM profiles WHERE did = $1', [did]),
      ])
      return gone.every((r) => r.length === 0)
    })
    await waitFor('tangled delete events', () => recordEvents(COLLECTIONS.tangledProfile, 'self', 'delete').length > 0 && recordEvents(COLLECTIONS.tangledLegacyProfile, 'self', 'delete').length > 0)
  }, waitMs * 8)

  it('acknowledges each event only after its handler succeeded', async () => {
    expect(seen.length).toBeGreaterThan(0)
    await waitFor('all handled events acked', () => seen.every((s) => s.marks.length === 2))
    for (const s of seen) expect(s.marks).toEqual(['handled', 'acked'])
  }, waitMs * 2)

  it.skipIf(!checkStatus)('updates repos when the account status changes', async () => {
    await xrpc('com.atproto.server.deactivateAccount', {})
    try {
      await waitFor('repos row inactive', async () => (await q<{ active: boolean; status: string }>('SELECT active, status FROM repos WHERE did = $1', [did]))[0]?.active === false)
      expect((await q<{ status: string }>('SELECT status FROM repos WHERE did = $1', [did]))[0]?.status).toBe('deactivated')
    } finally {
      await xrpc('com.atproto.server.activateAccount', {})
    }
    await waitFor('repos row active again', async () => (await q<{ active: boolean }>('SELECT active FROM repos WHERE did = $1', [did]))[0]?.active === true)
  }, waitMs * 4)
})
